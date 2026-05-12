import { supabase } from "@/integrations/supabase/client";

/**
 * Extracts bucket and path from a Supabase storage URL
 */
function extractFileInfo(url: string): { bucket: string; path: string } | null {
  if (!url) return null;

  try {
    // Supabase storage URL format:
    // https://[project].supabase.co/storage/v1/object/public/[bucket]/[path]
    const match = url.match(/\/storage\/v1\/object\/public\/([^\/]+)\/(.+)/);
    if (match) {
      return {
        bucket: match[1],
        path: decodeURIComponent(match[2].split('?')[0]) // Remove query params
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Deletes a file from Supabase storage
 */
async function deleteStorageFile(url: string): Promise<boolean> {
  const fileInfo = extractFileInfo(url);
  if (!fileInfo) return false;

  try {
    const { error } = await supabase.storage
      .from(fileInfo.bucket)
      .remove([fileInfo.path]);

    if (error) {
      console.error(`Failed to delete ${fileInfo.bucket}/${fileInfo.path}:`, error);
      return false;
    }

    console.log(`Deleted: ${fileInfo.bucket}/${fileInfo.path}`);
    return true;
  } catch (err) {
    console.error(`Error deleting file:`, err);
    return false;
  }
}

/**
 * Deletes all media files associated with a record
 */
async function cleanupRecordMedia(record: Record<string, any>): Promise<void> {
  const mediaFields = [
    'image_url',
    'video_url',
    'thumbnail_url',
    'cover_image_url',
    'profile_image_url',
    'media_url'
  ];

  const deletePromises = mediaFields
    .filter(field => record[field])
    .map(field => deleteStorageFile(record[field]));

  await Promise.allSettled(deletePromises);
}

/**
 * Hook for media cleanup operations
 */
export const useMediaCleanup = () => {
  /**
   * Delete a post and its associated media
   */
  const deletePost = async (postId: string): Promise<boolean> => {
    // First, get the post data to know what media to delete
    const { data: post, error: fetchError } = await supabase
      .from("posts")
      .select("*")
      .eq("id", postId)
      .single();

    if (fetchError || !post) {
      console.error("Failed to fetch post:", fetchError);
      return false;
    }

    // Delete the post from database, using .select() to verify it was actually deleted
    const { data: deleted, error: deleteError } = await supabase
      .from("posts")
      .delete()
      .eq("id", postId)
      .select();

    if (deleteError) {
      console.error("Failed to delete post:", deleteError);
      return false;
    }

    // If RLS blocked the delete, no rows will be returned
    if (!deleted || deleted.length === 0) {
      // Try admin RPC fallback
      console.warn("Direct delete returned 0 rows, trying admin RPC fallback...");
      const { error: rpcError } = await supabase.rpc("admin_delete_post", {
        _post_id: postId,
      });

      if (rpcError) {
        console.error("Admin RPC delete also failed:", rpcError);
        return false;
      }
    }

    // Cleanup media files
    await cleanupRecordMedia(post);

    return true;
  };

  /**
   * Delete an event and its associated media
   */
  const deleteEvent = async (eventId: string): Promise<boolean> => {
    const { data: event, error: fetchError } = await supabase
      .from("events")
      .select("*")
      .eq("id", eventId)
      .single();

    if (fetchError || !event) {
      console.error("Failed to fetch event:", fetchError);
      return false;
    }

    // Delete associated QR codes first
    await supabase.from("qr_codes").delete().eq("event_id", eventId);

    // Delete the event
    const { error: deleteError } = await supabase
      .from("events")
      .delete()
      .eq("id", eventId);

    if (deleteError) {
      console.error("Failed to delete event:", deleteError);
      return false;
    }

    await cleanupRecordMedia(event);
    return true;
  };

  /**
   * Delete a discount and its associated media
   */
  const deleteDiscount = async (discountId: string): Promise<boolean> => {
    const { data: discount, error: fetchError } = await supabase
      .from("discounts")
      .select("*")
      .eq("id", discountId)
      .single();

    if (fetchError || !discount) {
      console.error("Failed to fetch discount:", fetchError);
      return false;
    }

    // Delete associated QR codes first
    await supabase.from("qr_codes").delete().eq("discount_id", discountId);

    // Delete the discount
    const { error: deleteError } = await supabase
      .from("discounts")
      .delete()
      .eq("id", discountId);

    if (deleteError) {
      console.error("Failed to delete discount:", deleteError);
      return false;
    }

    await cleanupRecordMedia(discount);
    return true;
  };

  /**
   * Delete a story and its associated media
   */
  const deleteStory = async (storyId: string): Promise<boolean> => {
    const { data: story, error: fetchError } = await supabase
      .from("stories")
      .select("*")
      .eq("id", storyId)
      .single();

    if (fetchError || !story) {
      console.error("Failed to fetch story:", fetchError);
      return false;
    }

    const { error: deleteError } = await supabase
      .from("stories")
      .delete()
      .eq("id", storyId);

    if (deleteError) {
      console.error("Failed to delete story:", deleteError);
      return false;
    }

    await cleanupRecordMedia(story);
    return true;
  };

  /**
   * Delete a gallery item and its associated media
   */
  const deleteGalleryItem = async (galleryId: string): Promise<boolean> => {
    const { data: galleryItem, error: fetchError } = await supabase
      .from("gallery")
      .select("*")
      .eq("id", galleryId)
      .single();

    if (fetchError || !galleryItem) {
      console.error("Failed to fetch gallery item:", fetchError);
      return false;
    }

    const { error: deleteError } = await supabase
      .from("gallery")
      .delete()
      .eq("id", galleryId);

    if (deleteError) {
      console.error("Failed to delete gallery item:", deleteError);
      return false;
    }

    await cleanupRecordMedia(galleryItem);
    return true;
  };

  /**
   * Delete a single file from storage by URL
   */
  const deleteFile = async (url: string): Promise<boolean> => {
    return deleteStorageFile(url);
  };

  return {
    deletePost,
    deleteEvent,
    deleteDiscount,
    deleteStory,
    deleteGalleryItem,
    deleteFile,
    cleanupRecordMedia
  };
};

export default useMediaCleanup;
