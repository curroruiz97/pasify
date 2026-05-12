import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Flag, CheckCircle, XCircle, Clock } from "lucide-react";

interface ContentFlag {
  id: string;
  content_id: string;
  content_type: string;
  reason: string;
  description: string | null;
  status: string;
  reporter_user_id: string;
  created_at: string;
  moderation_notes: string | null;
  content?: any;
  reporter?: any;
}

const ModerationPanel = () => {
  const [flags, setFlags] = useState<ContentFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFlag, setSelectedFlag] = useState<string | null>(null);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    loadFlags();
    
    // Realtime subscription
    const channel = supabase
      .channel("moderation-flags")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "content_flags",
        },
        () => {
          loadFlags();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const loadFlags = async () => {
    setLoading(true);
    try {
      // Load manual flags
      const { data: flagData, error: flagError } = await supabase
        .from("content_flags")
        .select("*")
        .order("created_at", { ascending: false });

      if (flagError) throw flagError;

      // Load auto-moderated content
      const { data: autoModPosts } = await supabase
        .from("posts")
        .select("*, public_profiles(*)")
        .eq("auto_moderated", true)
        .eq("status", "pending")
        .order("created_at", { ascending: false });

      const { data: autoModComments } = await supabase
        .from("comments")
        .select("*")
        .eq("auto_moderated", true)
        .eq("status", "pending")
        .order("created_at", { ascending: false });

      const { data: autoModMessages } = await supabase
        .from("messages")
        .select("*")
        .eq("auto_moderated", true)
        .eq("status", "pending")
        .order("created_at", { ascending: false });

      const { data: autoModStories } = await supabase
        .from("stories")
        .select("*")
        .eq("auto_moderated", true)
        .eq("status", "pending")
        .order("created_at", { ascending: false });

      // Convert auto-moderated content to flag format
      const autoModFlags: ContentFlag[] = [
        ...(autoModPosts || []).map((post: any) => ({
          id: `auto-post-${post.id}`,
          content_id: post.id,
          content_type: "post",
          reason: post.moderation_category || "auto_moderation",
          description: post.moderation_reason,
          status: "pending",
          reporter_user_id: "system",
          created_at: post.created_at,
          moderation_notes: null,
          content: post,
          reporter: { first_name: "Sistema", last_name: "AI" }
        })),
        ...(autoModComments || []).map((comment: any) => ({
          id: `auto-comment-${comment.id}`,
          content_id: comment.id,
          content_type: "comment",
          reason: comment.moderation_category || "auto_moderation",
          description: comment.moderation_reason,
          status: "pending",
          reporter_user_id: "system",
          created_at: comment.created_at,
          moderation_notes: null,
          content: comment,
          reporter: { first_name: "Sistema", last_name: "AI" }
        })),
        ...(autoModMessages || []).map((message: any) => ({
          id: `auto-message-${message.id}`,
          content_id: message.id,
          content_type: "message",
          reason: message.moderation_category || "auto_moderation",
          description: message.moderation_reason,
          status: "pending",
          reporter_user_id: "system",
          created_at: message.created_at,
          moderation_notes: null,
          content: message,
          reporter: { first_name: "Sistema", last_name: "AI" }
        })),
        ...(autoModStories || []).map((story: any) => ({
          id: `auto-story-${story.id}`,
          content_id: story.id,
          content_type: "story",
          reason: story.moderation_category || "auto_moderation",
          description: story.moderation_reason,
          status: "pending",
          reporter_user_id: "system",
          created_at: story.created_at,
          moderation_notes: null,
          content: story,
          reporter: { first_name: "Sistema", last_name: "AI" }
        }))
      ];

      // Load content and reporter details for manual flags
      const flagsWithDetails = await Promise.all(
        (flagData || []).map(async (flag) => {
          let content = null;
          let reporter = null;

          // Load content based on type
          if (flag.content_type === "post" || flag.content_type === "video") {
            const { data: postData } = await supabase
              .from("posts")
              .select("*, public_profiles(*)")
              .eq("id", flag.content_id)
              .single();
            content = postData;
          } else if (flag.content_type === "message") {
            const { data: messageData } = await supabase
              .from("messages")
              .select("*")
              .eq("id", flag.content_id)
              .single();
            content = messageData;
          } else if (flag.content_type === "comment") {
            const { data: commentData } = await supabase
              .from("comments")
              .select("*")
              .eq("id", flag.content_id)
              .single();
            content = commentData;
          }

          // Load reporter profile
          const { data: reporterData } = await supabase
            .from("profiles")
            .select("first_name, last_name, business_name")
            .eq("id", flag.reporter_user_id)
            .single();
          reporter = reporterData;

          return {
            ...flag,
            content,
            reporter,
          };
        })
      );

      // Combine manual flags and auto-moderated flags
      setFlags([...autoModFlags, ...flagsWithDetails]);
    } catch (error) {
      console.error("Error loading flags:", error);
      toast.error("Error al cargar reportes");
    } finally {
      setLoading(false);
    }
  };

  const updateFlagStatus = async (
    flagId: string,
    status: "reviewed" | "resolved" | "dismissed"
  ) => {
    try {
      // Check if it's an auto-moderated flag
      if (flagId.startsWith("auto-")) {
        // Handle auto-moderated content approval/rejection
        // Parse the flag ID correctly - format is "auto-{type}-{uuid}"
        // Need to handle UUID with dashes correctly
        const prefix = flagId.substring(0, flagId.indexOf("-", 5)); // "auto-post", "auto-comment", etc.
        const contentType = prefix.replace("auto-", ""); // "post", "comment", etc.
        const contentId = flagId.substring(prefix.length + 1); // The full UUID after "auto-{type}-"
        
        if (status === "resolved") {
          // Approve the content
          const table = contentType === "post" ? "posts" :
                       contentType === "comment" ? "comments" :
                       contentType === "message" ? "messages" : "stories";
          
          const { error } = await supabase
            .from(table)
            .update({ status: "approved" })
            .eq("id", contentId);
          
          if (error) throw error;
          toast.success("Contenido aprobado correctamente");
        } else if (status === "dismissed") {
          // Keep as pending, admin dismissed the auto-moderation
          const table = contentType === "post" ? "posts" :
                       contentType === "comment" ? "comments" :
                       contentType === "message" ? "messages" : "stories";
          
          const { error } = await supabase
            .from(table)
            .update({ status: "approved", auto_moderated: false })
            .eq("id", contentId);
          
          if (error) throw error;
          toast.success("Auto-moderación descartada, contenido aprobado");
        }
      } else {
        // Handle manual flag
        const { error } = await supabase
          .from("content_flags")
          .update({
            status,
            moderation_notes: notes || null,
          })
          .eq("id", flagId);

        if (error) throw error;
        toast.success("Estado actualizado correctamente");
      }

      setNotes("");
      setSelectedFlag(null);
      loadFlags();
    } catch (error) {
      console.error("Error updating flag:", error);
      toast.error("Error al actualizar estado");
    }
  };

  const deleteContent = async (contentId: string, contentType: string) => {
    try {
      if (contentType === "post" || contentType === "video") {
        // Use admin RPC for reliable post deletion
        const { error } = await supabase.rpc("admin_delete_post", {
          _post_id: contentId,
        });
        if (error) throw error;
      } else if (contentType === "message") {
        const { data, error } = await supabase
          .from("messages")
          .delete()
          .eq("id", contentId)
          .select();
        if (error) throw error;
        if (!data || data.length === 0) throw new Error("Delete failed - no rows affected");
      } else if (contentType === "comment") {
        const { data, error } = await supabase
          .from("comments")
          .delete()
          .eq("id", contentId)
          .select();
        if (error) throw error;
        if (!data || data.length === 0) throw new Error("Delete failed - no rows affected");
      } else if (contentType === "story") {
        const { data, error } = await supabase
          .from("stories")
          .delete()
          .eq("id", contentId)
          .select();
        if (error) throw error;
        if (!data || data.length === 0) throw new Error("Delete failed - no rows affected");
      }

      toast.success("Contenido eliminado correctamente");
      loadFlags();
    } catch (error) {
      console.error("Error deleting content:", error);
      toast.error("Error al eliminar contenido");
    }
  };

  const getReasonLabel = (reason: string) => {
    const labels: Record<string, string> = {
      spam: "Spam",
      hate_speech: "Discurso de odio / Discriminación",
      harassment: "Acoso",
      violence: "Violencia / Tortura / Abuso",
      weapons: "Armas / Contenido peligroso",
      sexual_content: "Contenido sexual / Pornografía",
      misinformation: "Desinformación / Engaño",
      harmful_exploitation: "Explotación de eventos",
      inappropriate: "Inapropiado",
      auto_moderation: "Moderación automática AI",
      safe: "Contenido seguro",
      other: "Otro",
    };
    return labels[reason] || reason;
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: any; icon: any }> = {
      pending: { variant: "default", icon: Clock },
      reviewed: { variant: "secondary", icon: Flag },
      resolved: { variant: "default", icon: CheckCircle },
      dismissed: { variant: "outline", icon: XCircle },
    };

    const config = variants[status] || variants.pending;
    const Icon = config.icon;

    return (
      <Badge variant={config.variant}>
        <Icon className="w-3 h-3 mr-1" />
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  const filterByStatus = (status: string) => {
    return flags.filter((flag) => flag.status === status);
  };

  const FlagCard = ({ flag }: { flag: ContentFlag }) => {
    const isAutoModerated = flag.id.startsWith("auto-");
    const reporterName = isAutoModerated 
      ? "🤖 Sistema de Moderación AI"
      : flag.reporter?.first_name 
        ? `${flag.reporter.first_name} ${flag.reporter.last_name || ""}`.trim()
        : flag.reporter?.business_name || "Usuario desconocido";

    const contentAuthor = flag.content?.public_profiles?.first_name
      ? `${flag.content.public_profiles.first_name} ${flag.content.public_profiles.last_name || ""}`.trim()
      : flag.content?.public_profiles?.business_name || 
        (flag.content?.user_id ? `Usuario ${flag.content.user_id.slice(0, 8)}` : "Usuario desconocido");

    return (
      <Card key={flag.id} className={`mb-4 ${isAutoModerated ? 'border-l-4 border-l-orange-500' : ''}`}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              {isAutoModerated && <span className="text-orange-500">🤖</span>}
              {flag.content_type.toUpperCase()} - {getReasonLabel(flag.reason)}
            </CardTitle>
            {getStatusBadge(flag.status)}
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className={`p-3 rounded-lg ${isAutoModerated ? 'bg-orange-50 border border-orange-200' : 'bg-muted'}`}>
              <p className="text-sm font-medium mb-1">
                {isAutoModerated ? "Detectado por:" : "Reportado por:"}
              </p>
              <p className="text-sm">{reporterName}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {new Date(flag.created_at).toLocaleString("es-ES")}
              </p>
            </div>

            {flag.description && (
              <div className="bg-orange-50 p-3 rounded-lg border border-orange-200">
                <p className="text-sm font-medium mb-1">
                  {isAutoModerated ? "Razón AI:" : "Motivo:"}
                </p>
                <p className="text-sm">{flag.description}</p>
              </div>
            )}

            {flag.content && (
              <div className="bg-accent/10 p-3 rounded-lg border">
                <p className="text-sm font-medium mb-2">Contenido detectado:</p>
                <p className="text-xs text-muted-foreground mb-2">Autor: {contentAuthor}</p>
                {flag.content_type === "post" || flag.content_type === "video" ? (
                  <>
                    {flag.content.content && (
                      <p className="text-sm mb-2">{flag.content.content}</p>
                    )}
                    {flag.content.image_url && (
                      <img src={flag.content.image_url} alt="Content" className="w-full max-h-48 object-cover rounded mt-2" />
                    )}
                    {flag.content.video_url && (
                      <video src={flag.content.video_url} controls className="w-full max-h-48 rounded mt-2" />
                    )}
                  </>
                ) : flag.content_type === "message" ? (
                  <p className="text-sm">{flag.content.content}</p>
                ) : flag.content_type === "comment" ? (
                  <p className="text-sm">{flag.content.content}</p>
                ) : null}
              </div>
            )}

            {!flag.content && (
              <div className="bg-destructive/10 p-3 rounded-lg border border-destructive/20">
                <p className="text-sm text-destructive">El contenido ha sido eliminado o ya no está disponible</p>
              </div>
            )}

            {flag.moderation_notes && (
              <div>
                <p className="text-sm font-medium mb-1">Notas de moderación:</p>
                <p className="text-sm text-muted-foreground">{flag.moderation_notes}</p>
              </div>
            )}

          {selectedFlag === flag.id ? (
            <div className="space-y-2">
              <Textarea
                placeholder="Notas de moderación..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
              <div className="flex gap-2 flex-wrap">
                <Button
                  size="sm"
                  onClick={() => updateFlagStatus(flag.id, "resolved")}
                >
                  Resolver
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => updateFlagStatus(flag.id, "reviewed")}
                >
                  Revisar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => updateFlagStatus(flag.id, "dismissed")}
                >
                  Descartar
                </Button>
                {flag.content && (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      if (confirm("¿Estás seguro de que quieres eliminar este contenido? Esta acción no se puede deshacer.")) {
                        deleteContent(flag.content_id, flag.content_type);
                      }
                    }}
                  >
                    Eliminar Contenido
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSelectedFlag(null);
                    setNotes("");
                  }}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            flag.status === "pending" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSelectedFlag(flag.id)}
              >
                Moderar
              </Button>
            )
          )}
        </div>
      </CardContent>
    </Card>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Cargando reportes...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Panel de Moderación</h2>
        <Badge variant="outline">
          {filterByStatus("pending").length} pendientes
        </Badge>
      </div>

      <Tabs defaultValue="pending" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="pending">
            Pendientes ({filterByStatus("pending").length})
          </TabsTrigger>
          <TabsTrigger value="reviewed">
            Revisados ({filterByStatus("reviewed").length})
          </TabsTrigger>
          <TabsTrigger value="resolved">
            Resueltos ({filterByStatus("resolved").length})
          </TabsTrigger>
          <TabsTrigger value="dismissed">
            Descartados ({filterByStatus("dismissed").length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-4">
          {filterByStatus("pending").length === 0 ? (
            <Card>
              <CardContent className="text-center py-8">
                <p className="text-muted-foreground">No hay reportes pendientes</p>
              </CardContent>
            </Card>
          ) : (
            filterByStatus("pending").map((flag) => <FlagCard key={flag.id} flag={flag} />)
          )}
        </TabsContent>

        <TabsContent value="reviewed" className="mt-4">
          {filterByStatus("reviewed").length === 0 ? (
            <Card>
              <CardContent className="text-center py-8">
                <p className="text-muted-foreground">No hay reportes revisados</p>
              </CardContent>
            </Card>
          ) : (
            filterByStatus("reviewed").map((flag) => <FlagCard key={flag.id} flag={flag} />)
          )}
        </TabsContent>

        <TabsContent value="resolved" className="mt-4">
          {filterByStatus("resolved").length === 0 ? (
            <Card>
              <CardContent className="text-center py-8">
                <p className="text-muted-foreground">No hay reportes resueltos</p>
              </CardContent>
            </Card>
          ) : (
            filterByStatus("resolved").map((flag) => <FlagCard key={flag.id} flag={flag} />)
          )}
        </TabsContent>

        <TabsContent value="dismissed" className="mt-4">
          {filterByStatus("dismissed").length === 0 ? (
            <Card>
              <CardContent className="text-center py-8">
                <p className="text-muted-foreground">No hay reportes descartados</p>
              </CardContent>
            </Card>
          ) : (
            filterByStatus("dismissed").map((flag) => <FlagCard key={flag.id} flag={flag} />)
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ModerationPanel;
