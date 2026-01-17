import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import type { Tables } from "@/integrations/supabase/types";
import "webrtc-adapter";

type PrayerSession = Tables<"prayer_sessions">;
type PrayerParticipant = Tables<"prayer_participants">;

interface ParticipantWithProfile extends PrayerParticipant {
  profile?: {
    full_name: string;
    avatar_url: string | null;
  };
}

export function usePrayerSessions() {
  const [sessions, setSessions] = useState<PrayerSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSessions();

    const channel = supabase
      .channel("prayer_sessions_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "prayer_sessions" },
        () => fetchSessions()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchSessions = async () => {
    const { data, error } = await supabase
      .from("prayer_sessions")
      .select("*")
      .order("scheduled_at", { ascending: true });

    if (error) {
      console.error("Error fetching prayer sessions:", error);
    } else {
      setSessions(data || []);
    }
    setLoading(false);
  };

  const liveSessions = sessions.filter((s) => s.status === "active");
  const scheduledSessions = sessions.filter((s) => s.status === "scheduled");

  return { sessions, liveSessions, scheduledSessions, loading, refetch: fetchSessions };
}

export function usePrayerRoom(sessionId: string | null) {
  const { user } = useAuth();
  const [participants, setParticipants] = useState<ParticipantWithProfile[]>([]);
  const [session, setSession] = useState<PrayerSession | null>(null);
  const [myParticipation, setMyParticipation] = useState<PrayerParticipant | null>(null);
  const [myProfile, setMyProfile] = useState<{ full_name: string; avatar_url: string | null } | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [handRaised, setHandRaised] = useState(false);

  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Fetch my profile
  useEffect(() => {
    if (!user) return;
    
    const fetchMyProfile = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("full_name, avatar_url")
        .eq("user_id", user.id)
        .single();
      
      if (data) {
        setMyProfile(data);
      } else {
        // If no profile, use email as fallback
        setMyProfile({ full_name: user.email?.split("@")[0] || "User", avatar_url: null });
      }
    };
    
    fetchMyProfile();
  }, [user]);

  // Fetch session and participants
  useEffect(() => {
    if (!sessionId) return;

    fetchSessionData();
    subscribeToParticipants();

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [sessionId]);

  const fetchSessionData = async () => {
    if (!sessionId) return;

    const { data: sessionData } = await supabase
      .from("prayer_sessions")
      .select("*")
      .eq("id", sessionId)
      .single();

    if (sessionData) {
      setSession(sessionData);
    }

    await fetchParticipants();
  };

  const fetchParticipants = async () => {
    if (!sessionId) return;

    const { data } = await supabase
      .from("prayer_participants")
      .select("*")
      .eq("session_id", sessionId)
      .is("left_at", null);

    if (data) {
      // Fetch profiles for participants
      const userIds = data.map((p) => p.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, avatar_url")
        .in("user_id", userIds);

      const participantsWithProfiles = data.map((p) => ({
        ...p,
        profile: profiles?.find((pr) => pr.user_id === p.user_id),
      }));

      setParticipants(participantsWithProfiles);

      if (user) {
        const myPart = data.find((p) => p.user_id === user.id);
        setMyParticipation(myPart || null);
      }
    }
  };

  const subscribeToParticipants = () => {
    if (!sessionId) return;

    channelRef.current = supabase
      .channel(`prayer_room_${sessionId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "prayer_participants", filter: `session_id=eq.${sessionId}` },
        async (payload: any) => {
          console.log("Participant change:", payload);
          await fetchParticipants();
          
          // When a new participant joins, establish connection with them
          if (payload.eventType === "INSERT" && isConnected && localStream) {
            const newParticipant = payload.new;
            if (newParticipant.user_id !== user?.id && !newParticipant.left_at) {
              console.log("New participant joined, initiating connection:", newParticipant.user_id);
              // Small delay to let them set up their stream
              setTimeout(() => {
                initiateConnection(newParticipant.user_id, localStream);
              }, 1000);
            }
          }
        }
      )
      .on("broadcast", { event: "webrtc-signal" }, handleWebRTCSignal)
      .on("broadcast", { event: "hand-raised" }, (payload: any) => {
        // Refetch participants to get updated hand_raised status
        fetchParticipants();
      })
      .on("broadcast", { event: "participant-ready" }, async (payload: any) => {
        // When a new participant announces they are ready, connect to them
        const { userId } = payload.payload;
        if (userId !== user?.id && isConnected && localStream) {
          console.log("Participant ready, initiating connection:", userId);
          initiateConnection(userId, localStream);
        }
      })
      .subscribe();
  };

  const handleWebRTCSignal = async (payload: any) => {
    const { type, from, to, signal } = payload.payload;
    // Only process signals meant for us or broadcast signals
    if (from === user?.id) return;
    if (to && to !== user?.id) return; // Ignore signals not meant for us

    console.log(`WebRTC signal received: type=${type}, from=${from}`);

    try {
      let pc = peerConnections.current.get(from);
      
      if (type === "offer") {
        // Create new connection if we don't have one
        if (!pc) {
          pc = createPeerConnection(from, localStream);
        }
        await pc.setRemoteDescription(new RTCSessionDescription(signal));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        broadcastSignal("answer", from, answer);
        console.log(`Sent answer to ${from}`);
      } else if (type === "answer") {
        if (pc && pc.signalingState === "have-local-offer") {
          await pc.setRemoteDescription(new RTCSessionDescription(signal));
          console.log(`Set remote answer from ${from}`);
        }
      } else if (type === "ice-candidate") {
        if (pc && pc.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(signal));
          console.log(`Added ICE candidate from ${from}`);
        } else {
          console.log(`Queuing ICE candidate from ${from} - no remote description yet`);
        }
      }
    } catch (error) {
      console.error(`Error handling WebRTC signal from ${from}:`, error);
    }
  };

  const createPeerConnection = (peerId: string, stream?: MediaStream | null): RTCPeerConnection => {
    // Close existing connection if any
    const existingPc = peerConnections.current.get(peerId);
    if (existingPc) {
      existingPc.close();
      peerConnections.current.delete(peerId);
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
        { urls: "stun:stun4.l.google.com:19302" },
        // Add TURN servers for better connectivity
        { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
        { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
      ],
      iceCandidatePoolSize: 10,
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`Sending ICE candidate to ${peerId}`);
        broadcastSignal("ice-candidate", peerId, event.candidate);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`ICE connection state with ${peerId}: ${pc.iceConnectionState}`);
      if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected") {
        // Try to reconnect
        console.log(`Connection with ${peerId} ${pc.iceConnectionState}, may need reconnection`);
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`Connection state with ${peerId}: ${pc.connectionState}`);
    };

    pc.ontrack = (event) => {
      console.log("Received remote track from", peerId, event.track.kind, "enabled:", event.track.enabled);
      const remoteStream = event.streams[0];
      if (remoteStream) {
        setRemoteStreams((prev) => {
          const newMap = new Map(prev);
          newMap.set(peerId, remoteStream);
          return newMap;
        });
      }
    };

    // Use provided stream or fall back to localStream state
    const activeStream = stream || localStream;
    if (activeStream) {
      activeStream.getTracks().forEach((track) => {
        console.log(`Adding ${track.kind} track to peer connection for ${peerId}`);
        pc.addTrack(track, activeStream);
      });
    }

    peerConnections.current.set(peerId, pc);
    return pc;
  };

  const broadcastSignal = (type: string, to: string, signal: any) => {
    channelRef.current?.send({
      type: "broadcast",
      event: "webrtc-signal",
      payload: { type, from: user?.id, to, signal },
    });
  };

  const joinSession = async (withAudio: boolean, withVideo: boolean) => {
    if (!sessionId || !user) {
      toast({ title: "Error", description: "You must be logged in to join", variant: "destructive" });
      return;
    }

    try {
      // WebRTC requires secure context (HTTPS) on mobile browsers
      if (!window.isSecureContext && window.location.hostname !== "localhost") {
        throw new Error("Secure connection required. Please use HTTPS (or localhost) to allow camera/mic access.");
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Your browser doesn't support media devices. Please use a modern browser.");
      }

      // Always request both audio and video so we have tracks to enable/disable later
      // This ensures toggleMute and toggleVideo work properly
      let stream: MediaStream;
      
      try {
        // Try to get both audio and video
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        });
      } catch (bothErr) {
        console.warn("Failed to get both audio and video, trying separately:", bothErr);
        
        // Try audio only
        let audioStream: MediaStream | null = null;
        let videoStream: MediaStream | null = null;
        
        try {
          audioStream = await navigator.mediaDevices.getUserMedia({ 
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } 
          });
        } catch (audioErr) {
          console.warn("No audio available:", audioErr);
        }
        
        try {
          videoStream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" } 
          });
        } catch (videoErr) {
          console.warn("No video available:", videoErr);
        }
        
        if (!audioStream && !videoStream) {
          throw new Error("Could not access camera or microphone. Please check your device permissions.");
        }
        
        // Combine available tracks into one stream
        stream = new MediaStream();
        if (audioStream) {
          audioStream.getAudioTracks().forEach(track => stream.addTrack(track));
        }
        if (videoStream) {
          videoStream.getVideoTracks().forEach(track => stream.addTrack(track));
        }
      }

      // Set initial enabled state based on user preference
      stream.getAudioTracks().forEach((track) => {
        track.enabled = withAudio;
        console.log(`Audio track ${track.label}: enabled=${track.enabled}`);
      });
      stream.getVideoTracks().forEach((track) => {
        track.enabled = withVideo;
        console.log(`Video track ${track.label}: enabled=${track.enabled}`);
      });

      setLocalStream(stream);
      setIsMuted(!withAudio);
      setIsVideoOn(withVideo);

      // Join in database (upsert to handle rejoining)
      const { data, error } = await supabase
        .from("prayer_participants")
        .upsert({
          session_id: sessionId,
          user_id: user.id,
          can_speak: false,
          can_video: false,
          is_muted: !withAudio,
          left_at: null, // Clear left_at so they're active again
        }, {
          onConflict: "session_id,user_id"
        })
        .select()
        .single();

      if (error) throw error;

      setMyParticipation(data);
      setIsConnected(true);

      // Connect to other participants - pass stream directly since state hasn't updated yet
      participants.forEach((p) => {
        if (p.user_id !== user.id && !p.left_at) {
          console.log("Initiating connection to existing participant:", p.user_id);
          initiateConnection(p.user_id, stream);
        }
      });

      // Announce that we're ready so other participants can connect to us
      setTimeout(() => {
        channelRef.current?.send({
          type: "broadcast",
          event: "participant-ready",
          payload: { userId: user.id },
        });
      }, 500);

      toast({ title: "Joined", description: "You've joined the prayer session" });
    } catch (error: any) {
      console.error("Error joining session:", error);
      let errorMessage = error.message;
      
      if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
        errorMessage = "Permission denied. Please allow camera/mic in your browser settings.";
      } else if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
        errorMessage = "No camera or microphone found. Plug one in and try again.";
      } else if (error.name === "NotReadableError" || error.name === "TrackStartError") {
        errorMessage = "Camera/mic is busy in another app. Close it and retry.";
      } else if (error.name === "OverconstrainedError") {
        errorMessage = "Your device can't satisfy the requested quality. Lower video quality and retry.";
      }
      
      toast({ title: "Error", description: errorMessage, variant: "destructive" });
    }
  };

  const initiateConnection = async (peerId: string, stream?: MediaStream | null) => {
    const pc = createPeerConnection(peerId, stream);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    broadcastSignal("offer", peerId, offer);
  };

  const leaveSession = async () => {
    if (!myParticipation) return;

    // Clean up WebRTC
    peerConnections.current.forEach((pc) => pc.close());
    peerConnections.current.clear();
    localStream?.getTracks().forEach((track) => track.stop());

    // Update database
    await supabase
      .from("prayer_participants")
      .update({ left_at: new Date().toISOString() })
      .eq("id", myParticipation.id);

    setLocalStream(null);
    setRemoteStreams(new Map());
    setIsConnected(false);
    setMyParticipation(null);
  };

  const toggleMute = async () => {
    if (!localStream) {
      console.warn("Cannot toggle mute: no local stream");
      return;
    }
    
    const audioTracks = localStream.getAudioTracks();
    if (audioTracks.length === 0) {
      toast({ title: "No microphone", description: "No microphone is available", variant: "destructive" });
      return;
    }

    const newMuted = !isMuted;
    audioTracks.forEach((track) => {
      track.enabled = !newMuted;
      console.log(`Audio track ${track.label}: enabled=${track.enabled}`);
    });
    setIsMuted(newMuted);

    if (myParticipation) {
      await supabase
        .from("prayer_participants")
        .update({ is_muted: newMuted })
        .eq("id", myParticipation.id);
    }
  };

  const toggleVideo = async () => {
    if (!localStream) {
      console.warn("Cannot toggle video: no local stream");
      return;
    }
    
    const videoTracks = localStream.getVideoTracks();
    if (videoTracks.length === 0) {
      toast({ title: "No camera", description: "No camera is available", variant: "destructive" });
      return;
    }

    const newVideoOn = !isVideoOn;
    videoTracks.forEach((track) => {
      track.enabled = newVideoOn;
      console.log(`Video track ${track.label}: enabled=${track.enabled}`);
    });
    setIsVideoOn(newVideoOn);

    if (myParticipation) {
      await supabase
        .from("prayer_participants")
        .update({ can_video: newVideoOn })
        .eq("id", myParticipation.id);
    }
  };

  const raiseHand = async () => {
    const newHandRaised = !handRaised;
    setHandRaised(newHandRaised);
    
    // Update database so other participants can see
    if (myParticipation) {
      await supabase
        .from("prayer_participants")
        .update({ hand_raised: newHandRaised })
        .eq("id", myParticipation.id);
    }
    
    // Also broadcast for immediate notification
    channelRef.current?.send({
      type: "broadcast",
      event: "hand-raised",
      payload: { userId: user?.id, raised: newHandRaised },
    });
  };

  return {
    session,
    participants,
    myParticipation,
    myProfile,
    localStream,
    remoteStreams,
    isConnected,
    isMuted,
    isVideoOn,
    handRaised,
    joinSession,
    leaveSession,
    toggleMute,
    toggleVideo,
    raiseHand,
  };
}
