import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { 
  Mic, MicOff, Video, VideoOff, Hand, PhoneOff, Users, 
  Volume2, VolumeX, MessageSquare, Send, Settings, Monitor
} from "lucide-react";
import { usePrayerRoom } from "@/hooks/usePrayerSession";

interface PrayerRoomProps {
  sessionId: string;
  onLeave: () => void;
}

export function PrayerRoom({ sessionId, onLeave }: PrayerRoomProps) {
  const {
    session,
    participants,
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
  } = usePrayerRoom(sessionId);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const [showPreview, setShowPreview] = useState(true);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [previewMuted, setPreviewMuted] = useState(false);
  const [previewVideoOn, setPreviewVideoOn] = useState(true);
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{id: string; user: string; message: string; timestamp: Date}>>([]);
  const [chatInput, setChatInput] = useState("");
  const previewVideoRef = useRef<HTMLVideoElement>(null);

  // Preview setup
  useEffect(() => {
    if (showPreview && !isConnected) {
      setupPreview();
    }
    return () => {
      if (previewStream) {
        previewStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [showPreview, isConnected]);

  const setupPreview = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: { width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      setPreviewStream(stream);
      if (previewVideoRef.current) {
        previewVideoRef.current.srcObject = stream;
      }
    } catch (error: any) {
      console.error("Preview error:", error);
    }
  };

  const togglePreviewMute = () => {
    if (previewStream) {
      previewStream.getAudioTracks().forEach(track => track.enabled = previewMuted);
      setPreviewMuted(!previewMuted);
    }
  };

  const togglePreviewVideo = () => {
    if (previewStream) {
      previewStream.getVideoTracks().forEach(track => track.enabled = !previewVideoOn);
      setPreviewVideoOn(!previewVideoOn);
    }
  };

  const handleJoinNow = async () => {
    if (previewStream) {
      previewStream.getTracks().forEach(track => track.stop());
    }
    setShowPreview(false);
    await joinSession(!previewMuted, previewVideoOn);
  };

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  const handleLeave = async () => {
    await leaveSession();
    onLeave();
  };

  const sendMessage = () => {
    if (!chatInput.trim()) return;
    const newMessage = {
      id: Date.now().toString(),
      user: "You",
      message: chatInput,
      timestamp: new Date()
    };
    setChatMessages(prev => [...prev, newMessage]);
    setChatInput("");
    // In production, broadcast this via Supabase realtime
  };

  // Preview screen before joining
  if (!isConnected && showPreview) {
    return (
      <div className="flex flex-col items-center justify-center py-8 space-y-6">
        <div className="text-center mb-4">
          <h3 className="text-2xl font-serif font-semibold mb-2">Ready to join?</h3>
          <p className="text-muted-foreground">"{session?.title}"</p>
        </div>

        {/* Preview Video */}
        <Card className="relative overflow-hidden w-full max-w-2xl aspect-video bg-muted">
          {previewVideoOn && previewStream ? (
            <video
              ref={previewVideoRef}
              autoPlay
              muted
              playsInline
              className="w-full h-full object-cover mirror"
              style={{ transform: 'scaleX(-1)' }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/10 to-accent/10">
              <Avatar className="w-32 h-32">
                <AvatarFallback className="bg-accent/20 text-accent text-4xl">
                  You
                </AvatarFallback>
              </Avatar>
            </div>
          )}
          
          {/* Preview Controls */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3">
            <Button
              variant={previewMuted ? "destructive" : "secondary"}
              size="lg"
              className="rounded-full w-14 h-14 shadow-lg"
              onClick={togglePreviewMute}
            >
              {previewMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
            </Button>

            <Button
              variant={previewVideoOn ? "secondary" : "destructive"}
              size="lg"
              className="rounded-full w-14 h-14 shadow-lg"
              onClick={togglePreviewVideo}
            >
              {previewVideoOn ? <Video className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
            </Button>
          </div>
        </Card>

        <div className="flex gap-4">
          <Button 
            onClick={handleJoinNow} 
            size="lg"
            className="bg-accent text-accent-foreground hover:bg-accent/90"
          >
            Join now
          </Button>
        </div>
        
        <p className="text-sm text-muted-foreground text-center max-w-md">
          Check your camera and microphone before joining
        </p>
      </div>
    );
  }

  if (!isConnected) {
    return null;
  }

  return (
    <div className="h-[calc(100vh-12rem)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-4">
          <div>
            <h2 className="text-xl font-serif font-bold">{session?.title}</h2>
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Badge variant="destructive" className="text-xs">
                <span className="w-2 h-2 rounded-full bg-current mr-1.5 animate-pulse" />
                LIVE
              </Badge>
              <span className="text-muted-foreground">•</span>
              <Users className="w-3 h-3" />
              {participants.length} {participants.length === 1 ? 'participant' : 'participants'}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => setShowChat(!showChat)}
            className={showChat ? "bg-accent/10" : ""}
          >
            <MessageSquare className="w-4 h-4 mr-2" />
            Chat
          </Button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Main Video Area */}
        <div className="flex-1 p-4 overflow-y-auto">
          <div className={`grid gap-4 h-full ${
            participants.length === 1 ? 'grid-cols-1' :
            participants.length === 2 ? 'grid-cols-2' :
            participants.length <= 4 ? 'grid-cols-2 grid-rows-2' :
            participants.length <= 6 ? 'grid-cols-3 grid-rows-2' :
            participants.length <= 9 ? 'grid-cols-3 grid-rows-3' :
            'grid-cols-4 auto-rows-fr'
          }`}>
            {/* Local Video */}
            <Card className="relative overflow-hidden bg-muted group">
              {isVideoOn ? (
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-cover"
                  style={{ transform: 'scaleX(-1)' }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/10 to-accent/10">
                  <Avatar className="w-20 h-20">
                    <AvatarFallback className="bg-accent/20 text-accent text-2xl">
                      You
                    </AvatarFallback>
                  </Avatar>
                </div>
              )}
              <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
                <div className="flex items-center gap-2 px-2 py-1 rounded bg-black/60 backdrop-blur-sm">
                  <span className="text-white text-sm font-medium">You</span>
                  {isMuted && <MicOff className="w-3 h-3 text-white" />}
                </div>
              </div>
              {handRaised && (
                <div className="absolute top-3 right-3">
                  <div className="bg-accent text-accent-foreground rounded-full p-2 animate-bounce">
                    <Hand className="w-5 h-5" />
                  </div>
                </div>
              )}
            </Card>

            {/* Remote Participants */}
            {participants
              .filter((p) => p.user_id !== localStream?.id)
              .map((participant) => (
                <ParticipantVideo
                  key={participant.id}
                  participant={participant}
                  stream={remoteStreams.get(participant.user_id)}
                />
              ))}
          </div>
        </div>

        {/* Chat Sidebar */}
        {showChat && (
          <Card className="w-80 m-4 flex flex-col border-l">
            <CardContent className="p-4 flex-1 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold">Chat</h3>
                <Button variant="ghost" size="sm" onClick={() => setShowChat(false)}>
                  ✕
                </Button>
              </div>
              
              <ScrollArea className="flex-1 mb-4 pr-4">
                <div className="space-y-3">
                  {chatMessages.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No messages yet. Start the conversation!
                    </p>
                  ) : (
                    chatMessages.map((msg) => (
                      <div key={msg.id} className="space-y-1">
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm font-medium">{msg.user}</span>
                          <span className="text-xs text-muted-foreground">
                            {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="text-sm">{msg.message}</p>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
              
              <div className="flex gap-2">
                <Input
                  placeholder="Send a message..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                />
                <Button size="sm" onClick={sendMessage}>
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Bottom Controls Bar - Google Meet Style */}
      <div className="border-t bg-card">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant={isMuted ? "destructive" : "secondary"}
              size="lg"
              className="rounded-full w-14 h-14"
              onClick={toggleMute}
            >
              {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </Button>

            <Button
              variant={isVideoOn ? "secondary" : "destructive"}
              size="lg"
              className="rounded-full w-14 h-14"
              onClick={toggleVideo}
            >
              {isVideoOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
            </Button>

            <Button
              variant="outline"
              size="lg"
              className={`rounded-full w-14 h-14 ${handRaised ? "bg-accent text-accent-foreground" : ""}`}
              onClick={raiseHand}
            >
              <Hand className="w-5 h-5" />
            </Button>

            <div className="h-8 w-px bg-border mx-2" />

            <Button
              variant="destructive"
              size="lg"
              className="rounded-full px-6"
              onClick={handleLeave}
            >
              <PhoneOff className="w-5 h-5 mr-2" />
              Leave
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="rounded-full w-10 h-10">
              <Settings className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ParticipantVideoProps {
  participant: any;
  stream?: MediaStream;
}

function ParticipantVideo({ participant, stream }: ParticipantVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const hasVideo = stream && participant.can_video;

  return (
    <Card className="relative overflow-hidden bg-muted group hover:ring-2 hover:ring-accent transition-all">
      {hasVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/10 to-accent/10 aspect-video">
          <Avatar className="w-20 h-20">
            <AvatarImage src={participant.profile?.avatar_url} />
            <AvatarFallback className="bg-accent/20 text-accent text-2xl">
              {participant.profile?.full_name?.[0] || "?"}
            </AvatarFallback>
          </Avatar>
        </div>
      )}
      <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="flex items-center gap-2 px-2 py-1 rounded bg-black/60 backdrop-blur-sm">
          <span className="text-white text-sm font-medium">
            {participant.profile?.full_name || "Anonymous"}
          </span>
          {participant.is_muted && <MicOff className="w-3 h-3 text-white" />}
        </div>
      </div>
      {/* Always show name tag */}
      <div className="absolute bottom-3 left-3 px-2 py-1 rounded bg-black/60 backdrop-blur-sm group-hover:opacity-0 transition-opacity">
        <span className="text-white text-sm font-medium">
          {participant.profile?.full_name || "Anonymous"}
        </span>
      </div>
    </Card>
  );
}
