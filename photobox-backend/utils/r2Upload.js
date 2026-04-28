const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

// Cloudflare R2 Credentials (Loaded from .env)
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || 'f750ff2feb7393044ebe91cb1971a7ea'; 
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_ENDPOINT = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

const BUCKET_NAME = 'photobox-galleries';
const PUBLIC_DEV_URL = 'https://neodigiland.site';

// Configure S3 Client for Cloudflare R2
const S3 = new S3Client({
    region: 'auto', // R2 requires 'auto'
    endpoint: R2_ENDPOINT,
    credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
});

/**
 * Uploads a base64 image string to Cloudflare R2
 * @param {string} base64Data - The pure base64 string (without data:image/... prefix)
 * @param {string} path - The folder path in the bucket (e.g., 'G-12345/strip.jpg')
 * @param {string} contentType - The mime type of the file
 * @returns {Promise<string|null>} - Returns the public URL, or null if failed
 */
async function uploadToR2(base64Data, path, contentType = 'image/jpeg') {
    try {
        const buffer = Buffer.from(base64Data, 'base64');
        
        const command = new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: path,
            Body: buffer,
            ContentType: contentType,
        });

        await S3.send(command);
        
        // Return the public URL for the newly uploaded file
        return `${PUBLIC_DEV_URL}/${path}`;
    } catch (error) {
        console.error(`[R2] Upload failed for ${path}:`, error.message);
        return null;
    }
}

module.exports = { uploadToR2 };
