import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const { type, record, old_record } = await req.json();

    // Get the record to delete media from (use old_record for DELETE operations)
    const data = old_record || record;

    if (!data) {
      return new Response(
        JSON.stringify({ error: "No record data provided" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const filesToDelete: { bucket: string; path: string }[] = [];

    // Collect all media URLs to delete based on record type
    const mediaFields = [
      'image_url',
      'video_url',
      'thumbnail_url',
      'cover_image_url',
      'profile_image_url',
      'media_url'
    ];

    for (const field of mediaFields) {
      if (data[field]) {
        const fileInfo = extractFileInfo(data[field]);
        if (fileInfo) {
          filesToDelete.push(fileInfo);
        }
      }
    }

    // Delete files from storage
    const deleteResults = [];
    for (const file of filesToDelete) {
      try {
        const { error } = await supabaseAdmin.storage
          .from(file.bucket)
          .remove([file.path]);

        if (error) {
          console.error(`Failed to delete ${file.bucket}/${file.path}:`, error);
          deleteResults.push({ file: `${file.bucket}/${file.path}`, success: false, error: error.message });
        } else {
          console.log(`Deleted: ${file.bucket}/${file.path}`);
          deleteResults.push({ file: `${file.bucket}/${file.path}`, success: true });
        }
      } catch (err) {
        console.error(`Error deleting ${file.bucket}/${file.path}:`, err);
        deleteResults.push({ file: `${file.bucket}/${file.path}`, success: false, error: String(err) });
      }
    }

    return new Response(
      JSON.stringify({
        message: "Media cleanup completed",
        deleted: deleteResults.filter(r => r.success).length,
        failed: deleteResults.filter(r => !r.success).length,
        results: deleteResults
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Cleanup error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});

// Extract bucket and path from Supabase storage URL
function extractFileInfo(url: string): { bucket: string; path: string } | null {
  if (!url) return null;

  try {
    // Supabase storage URL format:
    // https://[project].supabase.co/storage/v1/object/public/[bucket]/[path]
    const match = url.match(/\/storage\/v1\/object\/public\/([^\/]+)\/(.+)/);
    if (match) {
      return {
        bucket: match[1],
        path: decodeURIComponent(match[2])
      };
    }

    // Alternative format with signed URLs
    const signedMatch = url.match(/\/storage\/v1\/object\/sign\/([^\/]+)\/(.+)\?/);
    if (signedMatch) {
      return {
        bucket: signedMatch[1],
        path: decodeURIComponent(signedMatch[2])
      };
    }

    return null;
  } catch {
    return null;
  }
}
