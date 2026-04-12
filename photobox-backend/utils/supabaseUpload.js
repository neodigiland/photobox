const { createClient } = require('@supabase/supabase-js');

// TODO: Replace with your actual Supabase Project credentials
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://YOUR-PROJECT.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'YOUR-SERVICE-ROLE-KEY-OR-ANON-KEY';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Uploads a base64 image string to Supabase Storage
 * @param {string} base64Data - The pure base64 string (without data:image/... prefix)
 * @param {string} path - The folder path in the bucket (e.g., 'G-12345/strip.jpg')
 * @returns {Promise<string|null>} - Returns the public URL, or null if failed
 */
async function uploadToSupabase(base64Data, path, contentType = 'image/jpeg') {
    try {
        const buffer = Buffer.from(base64Data, 'base64');
        
        const { data, error } = await supabase.storage
            .from('photobox-galleries')
            .upload(path, buffer, {
                contentType: contentType,
                upsert: true
            });

        if (error) throw error;
        
        // Return strictly the path so we can fetch public URL dynamically
        // Or directly construct the public URL if buckets are public:
        const { data: publicUrlData } = supabase.storage
            .from('photobox-galleries')
            .getPublicUrl(path);

        return publicUrlData.publicUrl;
    } catch (error) {
        console.error(`[SUPABASE] Upload failed for ${path}:`, error.message);
        return null;
    }
}

module.exports = { uploadToSupabase };
