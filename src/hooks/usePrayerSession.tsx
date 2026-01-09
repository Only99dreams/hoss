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
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [handRaised, setHandRaised] = useState(false);

  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

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
        () => fetchParticipants()
      )
      .on("broadcast", { event: "webrtc-signal" }, handleWebRTCSignal)
      .subscribe();
  };

  const handleWebRTCSignal = async (payload: any) => {
    const { type, from, signal } = payload.payload;
    if (from === user?.id) return;

    const pc = peerConnections.current.get(from) || createPeerConnection(from);

    if (type === "offer") {
      await pc.setRemoteDescription(new RTCSessionDescription(signal));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      broadcastSignal("answer", from, answer);
    } else if (type === "answer") {
      await pc.setRemoteDescription(new RTCSessionDescription(signal));
    } else if (type === "ice-candidate") {
      await pc.addIceCandidate(new RTCIceCandidate(signal));
    }
  };

  const createPeerConnection = (peerId: string): RTCPeerConnection => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
        { urls: "stun:stun4.l.google.com:19302" },
      ],
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        broadcastSignal("ice-candidate", peerId, event.candidate);
      }
    };

    pc.ontrack = (event) => {
      setRemoteStreams((prev) => {
        const newMap = new Map(prev);
        newMap.set(peerId, event.streams[0]);
        return newMap;
      });
    };

    if (localStream) {
      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
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

      const constraints: MediaStreamConstraints = {
        audio: withAudio ? { echoCancellation: true, noiseSuppression: true } : false,
        video: withVideo ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" } : false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      stream.getAudioTracks().forEach((track) => (track.enabled = withAudio));
      stream.getVideoTracks().forEach((track) => (track.enabled = withVideo));

      setLocalStream(stream);
      setIsMuted(!withAudio);
      setIsVideoOn(withVideo);

      // Join in database
      const { data, error } = await supabase
        .from("prayer_participants")
        .insert({
          session_id: sessionId,
          user_id: user.id,
          can_speak: false,
          can_video: false,
          is_muted: !withAudio,
        })
        .select()
        .single();

      if (error) throw error;

      setMyParticipation(data);
      setIsConnected(true);

      // Connect to other participants
      participants.forEach((p) => {
        if (p.user_id !== user.id) {
          initiateConnection(p.user_id);
        }
      });

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

  const initiateConnection = async (peerId: string) => {
    const pc = createPeerConnection(peerId);
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
    if (!localStream || !myParticipation) return;

    const newMuted = !isMuted;
    localStream.getAudioTracks().forEach((track) => (track.enabled = !newMuted));
    setIsMuted(newMuted);

    await supabase
      .from("prayer_participants")
      .update({ is_muted: newMuted })
      .eq("id", myParticipation.id);
  };

  const toggleVideo = () => {
    if (!localStream) return;

    const newVideoOn = !isVideoOn;
    localStream.getVideoTracks().forEach((track) => (track.enabled = newVideoOn));
    setIsVideoOn(newVideoOn);
  };

  const raiseHand = async () => {
    setHandRaised(!handRaised);
    // Broadcast hand raise status through channel
    channelRef.current?.send({
      type: "broadcast",
      event: "hand-raised",
      payload: { userId: user?.id, raised: !handRaised },
    });
  };

  return {
    session,
    participants,
    myParticipation,
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
