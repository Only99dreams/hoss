import { useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";

interface StreamPlayerProps {
  stream?: MediaStream | null;
  externalUrl?: string | null;
  isLive?: boolean;
  title?: string;
  viewerCount?: number;
}

export function StreamPlayer({ stream, externalUrl, isLive, title, viewerCount = 0 }: StreamPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <Card className="relative overflow-hidden bg-card/50 backdrop-blur-sm border-border/50">
      <div className="aspect-video bg-muted relative">
        {externalUrl ? (
          <iframe
            src={externalUrl}
            className="w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            title={title || "Live Stream"}
          />
        ) : stream ? (
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-cover"
          />
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
          <div className="absolute top-4 left-4 flex items-center gap-2">
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
          <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-background/90 to-transparent">
            <h3 className="text-lg font-semibold text-foreground">{title}</h3>
          </div>
        )}
      </div>
    </Card>
  );
}
