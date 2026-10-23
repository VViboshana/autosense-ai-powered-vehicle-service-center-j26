import { describe, expect, it } from 'vitest';
import { looksLikeImage, photoUrl } from './vehiclePhotos.js';

describe('vehicle photos', () => {
  it('accepts a file only when its first bytes match the image type it claims', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
    const webp = Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1');
    expect(looksLikeImage(jpeg, 'image/jpeg')).toBe(true);
    expect(looksLikeImage(png, 'image/png')).toBe(true);
    expect(looksLikeImage(webp, 'image/webp')).toBe(true);
    expect(looksLikeImage(png, 'image/jpeg')).toBe(false);
    expect(looksLikeImage(Buffer.from('<html>'), 'image/png')).toBe(false);
    expect(looksLikeImage(jpeg, 'image/gif')).toBe(false);
  });

  it('gives a changed photo a new URL, and no URL when there is no photo', () => {
    expect(photoUrl('/api/my/vehicles/7/photo', 'vehicles/3f2a9c1e-aaaa.jpg')).toBe('/api/my/vehicles/7/photo?v=3f2a9c1e');
    expect(photoUrl('/api/my/vehicles/7/photo', null)).toBeNull();
  });
});
