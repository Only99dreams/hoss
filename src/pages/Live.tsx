import { useState, useEffect } from "react";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Radio, Play, Calendar, Clock, Eye } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useLiveStream } from "@/hooks/useLiveStream";
import { StreamPlayer } from "@/components/live/StreamPlayer";
import { StreamControls } from "@/components/live/StreamControls";
import { ActiveStreams } from "@/components/live/ActiveStreams";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";

interface ScheduledStream {
  id: string;
  title: string;
  scheduled_at: string | null;
  description: string | null;
}

interface PastStream {
  id: string;
  title: string;
  ended_at: string | null;
  started_at: string | null;
  recording_url: string | null;
  view_count?: number;
}

const Live = () => {
  const { user, isAdmin } = useAuth();
  const {
    isStreaming,
    isRecording,
    localStream,
    viewerCount,
    streamKey,
    externalStreamUrl,
    startStream,
    stopStream,
    startRecording,
    stopRecording,
  } = useLiveStream();

  const [selectedStreamId, setSelectedStreamId] = useState<string | null>(null);
  const [selectedStream, setSelectedStream] = useState<{ id: string; title: string; external_stream_url: string | null } | null>(null);
  const [upcomingStreams, setUpcomingStreams] = useState<ScheduledStream[]>([]);
  const [pastStreams, setPastStreams] = useState<PastStream[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStreams();

    // Subscribe to realtime updates
    const channel = supabase
      .channel("live-streams-page")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "live_streams" },
        () => fetchStreams()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchStreams = async () => {
    const [scheduledRes, pastRes] = await Promise.all([
      supabase
        .from("live_streams")
        .select("id, title, scheduled_at, description")
        .eq("status", "scheduled")
        .order("scheduled_at", { ascending: true }),
      supabase
        .from("live_streams")
        .select("id, title, ended_at, started_at, recording_url")
        .eq("status", "ended")
        .order("ended_at", { ascending: false })
        .limit(6),
    ]);

    if (scheduledRes.data) setUpcomingStreams(scheduledRes.data);
    if (pastRes.data) setPastStreams(pastRes.data);
    setLoading(false);
  };

  const formatDuration = (start: string | null, end: string | null) => {
    if (!start || !end) return "N/A";
    const diff = new Date(end).getTime() - new Date(start).getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  };

  const handleJoinStream = async (streamId: string) => {
    setSelectedStreamId(streamId);
    // Fetch stream data to get external URL
    const { data } = await supabase
      .from("live_streams")
      .select("id, title, external_stream_url")
      .eq("id", streamId)
      .single();
    
    if (data) {
      setSelectedStream(data);
    }
  };

  return (
    <Layout>
      {/* Hero Section */}
      <section className="relative py-12 md:py-20 gradient-hero overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 left-10 w-72 h-72 rounded-full bg-accent blur-3xl animate-float" />
        </div>
        <div className="container relative z-10 text-center">
          <Badge variant="outline" className="border-primary-foreground/30 text-primary-foreground mb-4">
            <Radio className="w-3 h-3 mr-1" />
            Live Streaming
          </Badge>
          <h1 className="text-4xl md:text-5xl font-serif font-bold text-primary-foreground mb-4">
            Watch Live Services
          </h1>
          <p className="text-primary-foreground/80 max-w-2xl mx-auto">
            Join us for live broadcasts of our services, special events, and prayer sessions
          </p>
        </div>
      </section>

      {/* Main Content */}
      <section className="py-12 md:py-16">
        <div className="container">
          {/* Admin streaming controls are now available only in the admin area */}
          {isAdmin && (
            <div className="mb-6">
              <Card className="border-border/50">
                <CardContent className="p-4 text-sm text-muted-foreground flex flex-col gap-2">
                  <span className="font-semibold text-foreground">Admin streaming controls</span>
                  <span>Go to the Admin panel to start or manage live streams.</span>
                  <Button asChild className="w-fit mt-2 bg-accent text-accent-foreground hover:bg-accent/90">
                    <a href="/admin">Open Admin Streaming</a>
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Active Streams for Viewers */}
          {!isAdmin && (
            <div className="mb-12">
              <ActiveStreams onJoinStream={handleJoinStream} />
            </div>
          )}

          {/* Viewer Stream Player */}
          {selectedStream && !isAdmin && (
            <div className="mb-12">
              <StreamPlayer
                externalUrl={selectedStream.external_stream_url}
                isLive={true}
                title={selectedStream.title}
              />
            </div>
          )}

          {/* Two Column Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Upcoming Streams */}
            <div className="lg:col-span-1">
              <h3 className="text-xl font-serif font-semibold mb-4">Upcoming Streams</h3>
              <div className="space-y-4">
                {loading ? (
                  <>
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-24 w-full" />
                  </>
                ) : upcomingStreams.length === 0 ? (
                  <Card className="border-border/50">
                    <CardContent className="p-4 text-center text-muted-foreground">
                      No upcoming streams scheduled
                    </CardContent>
                  </Card>
                ) : (
                  upcomingStreams.map((stream) => (
                    <Card key={stream.id} className="hover:shadow-card transition-shadow border-border/50">
                      <CardContent className="p-4">
                        <h4 className="font-semibold mb-2">{stream.title}</h4>
                        {stream.description && (
                          <p className="text-sm text-muted-foreground mb-2 line-clamp-2">{stream.description}</p>
                        )}
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          {stream.scheduled_at && (
                            <>
                              <span className="flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                {format(new Date(stream.scheduled_at), "EEE, MMM d")}
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {format(new Date(stream.scheduled_at), "h:mm a")}
                              </span>
                            </>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </div>

            {/* Past Streams */}
            <div className="lg:col-span-2">
              <h3 className="text-xl font-serif font-semibold mb-4">Recent Recordings</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {loading ? (
                  <>
                    <Skeleton className="h-48 w-full" />
                    <Skeleton className="h-48 w-full" />
                  </>
                ) : pastStreams.length === 0 ? (
                  <Card className="border-border/50 col-span-full">
                    <CardContent className="p-8 text-center text-muted-foreground">
                      No recordings available yet
                    </CardContent>
                  </Card>
                ) : (
                  pastStreams.map((stream) => (
                    <Card key={stream.id} className="overflow-hidden group hover:shadow-card transition-shadow cursor-pointer border-border/50">
                      <div className="relative aspect-video bg-muted">
                        {stream.recording_url ? (
                          <video
                            src={stream.recording_url}
                            className="w-full h-full object-cover"
                            poster=""
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-accent/20">
                            <Play className="w-12 h-12 text-muted-foreground" />
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                            <Play className="w-7 h-7 text-white" />
                          </div>
                        </div>
                        <Badge className="absolute bottom-2 right-2 bg-black/70">
                          {formatDuration(stream.started_at, stream.ended_at)}
                        </Badge>
                      </div>
                      <CardContent className="p-4">
                        <h4 className="font-semibold mb-1 group-hover:text-accent transition-colors">{stream.title}</h4>
                        <div className="flex items-center justify-between text-sm text-muted-foreground">
                          <span>{stream.ended_at ? format(new Date(stream.ended_at), "MMM d, yyyy") : "N/A"}</span>
                          {stream.view_count !== undefined && (
                            <span className="flex items-center gap-1">
                              <Eye className="w-3 h-3" />
                              {stream.view_count.toLocaleString()}
                            </span>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
};

export default Live;
