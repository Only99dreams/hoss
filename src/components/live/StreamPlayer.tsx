import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Volume2, VolumeX, Maximize, Play, Pause } from "lucide-react";

interface StreamPlayerProps {
  stream?: MediaStream | null;
  externalUrl?: string | null;
  isLive?: boolean;
  title?: string;
  viewerCount?: number;
}

// Helper to convert YouTube URL to embed format
const getEmbedUrl = (url: string): string => {
  if (!url) return url;
  
  // YouTube watch URL
  const ytWatchMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
  if (ytWatchMatch) {
    return `https://www.youtube.com/embed/${ytWatchMatch[1]}?autoplay=1&rel=0`;
  }
  
  // YouTube live URL
  const ytLiveMatch = url.match(/youtube\.com\/live\/([a-zA-Z0-9_-]+)/);
  if (ytLiveMatch) {
    return `https://www.youtube.com/embed/${ytLiveMatch[1]}?autoplay=1&rel=0`;
  }
  
  // Facebook video
  if (url.includes("facebook.com")) {
    return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&autoplay=true`;
  }
  
  // Already an embed URL or other direct URL
  return url;
};

export function StreamPlayer({ stream, externalUrl, isLive, title, viewerCount = 0 }: StreamPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isMuted, setIsMuted] = useState(true);
  const [isPlaying, setIsPlaying] = useState(true);
  const [showControls, setShowControls] = useState(false);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(console.error);
    }
  }, [stream]);

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted;
      setIsMuted(!isMuted);
    }
  };

  const togglePlay = () => {
    if (videoRef.current) {
      if (videoRef.current.paused) {
        videoRef.current.play();
        setIsPlaying(true);
      } else {
        videoRef.current.pause();
        setIsPlaying(false);
      }
    }
  };

  const goFullscreen = () => {
    const container = videoRef.current?.parentElement;
    if (container?.requestFullscreen) {
      container.requestFullscreen();
    }
  };

  const embedUrl = externalUrl ? getEmbedUrl(externalUrl) : null;

  return (
    <Card className="relative overflow-hidden bg-card/50 backdrop-blur-sm border-border/50">
      <div 
        className="aspect-video bg-black relative group"
        onMouseEnter={() => setShowControls(true)}
        onMouseLeave={() => setShowControls(false)}
      >
        {embedUrl ? (
          <iframe
            src={embedUrl}
            className="w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            title={title || "Live Stream"}
          />
        ) : stream ? (
          <>
            <video
              ref={videoRef}
              autoPlay
              muted={isMuted}
              playsInline
              className="w-full h-full object-contain bg-black"
            />
            
            {/* Video Controls */}
            <div className={`absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent transition-opacity ${showControls ? 'opacity-100' : 'opacity-0'}`}>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={togglePlay} className="text-white hover:bg-white/20">
                  {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                </Button>
                <Button size="sm" variant="ghost" onClick={toggleMute} className="text-white hover:bg-white/20">
                  {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </Button>
                <div className="flex-1" />
                <Button size="sm" variant="ghost" onClick={goFullscreen} className="text-white hover:bg-white/20">
                  <Maximize className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted-foreground/20 flex items-center justify-center">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="text-lg font-medium">No stream available</p>
              <p className="text-sm">Waiting for broadcast to start...</p>
            </div>
          </div>
        )}

        {/* Live indicator */}
        {isLive && (
          <div className="absolute top-4 left-4 flex items-center gap-2 z-10">
            <span className="flex items-center gap-1.5 px-2 py-1 bg-destructive text-destructive-foreground text-xs font-semibold rounded">
              <span className="w-2 h-2 rounded-full bg-current animate-pulse" />
              LIVE
            </span>
            {viewerCount > 0 && (
              <span className="px-2 py-1 bg-background/80 backdrop-blur-sm text-foreground text-xs font-medium rounded">
                {viewerCount} watching
              </span>
            )}
          </div>
        )}

        {/* Title overlay */}
        {title && (
          <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-background/90 to-transparent pointer-events-none">
            <h3 className="text-lg font-semibold text-foreground">{title}</h3>
          </div>
        )}
      </div>
    </Card>
  );
}
