// Proof photos for tasks that require one before they can be completed.
//
// Uses the task-attachments bucket that task comments already write to, so no
// new storage configuration is needed.

import { supabase } from './supabase';

// Phone cameras produce 4–12 MB files. The photo only has to show that the work
// was done, so it is downscaled before upload — faster on restaurant wifi and
// far cheaper to store.
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;

async function downscale(file: File): Promise<Blob> {
    if (!file.type.startsWith('image/')) return file;

    try {
        // Without from-image, a portrait phone photo is re-encoded sideways:
        // the EXIF orientation tag is dropped and never applied to the pixels.
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);

        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no 2d context');
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();

        const blob = await new Promise<Blob | null>(resolve =>
            canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
        return blob ?? file;
    } catch {
        // HEIC without a decoder, or low memory. The original still uploads.
        return file;
    }
}

export interface ProofUploadResult {
    url: string;
}

export async function uploadTaskProof(taskId: string, file: File): Promise<ProofUploadResult> {
    const blob = await downscale(file);
    const ext = blob.type === 'image/jpeg' ? 'jpg' : (file.name.split('.').pop() || 'jpg');
    const path = `proof/${taskId}/${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
        .from('task-attachments')
        .upload(path, blob, { contentType: blob.type || 'image/jpeg' });

    if (uploadError) throw new Error(`Could not upload the photo: ${uploadError.message}`);

    const { data } = supabase.storage.from('task-attachments').getPublicUrl(path);
    const url = data?.publicUrl;
    if (!url) throw new Error('The photo uploaded but no link came back.');

    // getPublicUrl only builds a string — it succeeds even when the bucket is
    // private. Storing an unreachable link would satisfy the completion rule
    // while losing the evidence it exists to keep, so the link is checked.
    try {
        const probe = await fetch(url, { method: 'HEAD' });
        if (!probe.ok) {
            throw new Error(
                'The photo uploaded but is not publicly readable. Make the task-attachments bucket public.',
            );
        }
    } catch (e) {
        if (e instanceof Error && e.message.includes('not publicly readable')) throw e;
        // A network hiccup on the probe alone should not lose a good upload.
        console.warn('Could not verify the photo link:', e);
    }

    return { url };
}

// Saves the proof against the task. Deliberately separate from completing it:
// the photo is attached first, and only then can the status move.
export async function attachTaskProof(taskId: string, url: string): Promise<void> {
    const { error } = await supabase
        .from('tasks')
        .update({ proof_url: url, proof_uploaded_at: new Date().toISOString() })
        .eq('id', taskId);
    if (error) throw new Error(error.message);
}

export function taskNeedsProof(task: { requires_photo?: boolean; proof_url?: string | null }): boolean {
    return Boolean(task.requires_photo) && !task.proof_url;
}
