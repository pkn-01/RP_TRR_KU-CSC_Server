// ===== อัปโหลดไฟล์ Cloudinary | Cloudinary File Upload Service =====
import { Injectable, Logger } from '@nestjs/common';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);

  constructor() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }

  /**
   * อัปโหลดไฟล์ไปยัง Cloudinary 
   * @param buffer - File buffer
   * @param originalname - Original filename
   * @param folder - Cloudinary folder to store the file
   * @returns Cloudinary upload result with URL
   */
  async uploadFile(
    buffer: Buffer,
    originalname: string,
    folder: string = 'repairs',
  ): Promise<{ url: string; publicId: string }> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'auto',
          public_id: `${Date.now()}-${originalname.replace(/\.[^/.]+$/, '')}`,
        },
        (error, result: UploadApiResponse | undefined) => {
          if (error) {
            this.logger.error('เกิดข้อผิดพลาดในการอัปโหลดไฟล์:', error);
            reject(error);
          } else if (result) {
            resolve({
              url: result.secure_url,
              publicId: result.public_id,
            });
          } else {
            reject(new Error('อัปโหลดไฟล์ไม่สำเร็จ: ไม่ได้รับผลลัพธ์'));
          }
        },
      );

      uploadStream.end(buffer);
    });
  }

  /**
   * ลบไฟล์จาก Cloudinary ตาม public ID 
   * @param publicId 
   */
  async deleteFile(publicId: string): Promise<void> {
    try {
      await cloudinary.uploader.destroy(publicId);
    } catch (error) {
      this.logger.error('เกิดข้อผิดพลาดในการลบไฟล์จาก Cloudinary:', error);
      throw error;
    }
  }

  /**
   * แยก public ID ออกจาก URL ของ Cloudinary 
   * @param url 
   * @returns 
   */
  extractPublicIdFromUrl(url: string): string | null {
    try {
      if (!url) return null;
      
      
      const regex = /\/upload\/(?:v\d+\/)?(.+)\.[^.]+$/;
      const match = url.match(regex);
      
      if (match && match[1]) {
        return match[1];
      }
      
      return null;
    } catch (error) {
      this.logger.error('เกิดข้อผิดพลาดในการแยก public ID จาก URL:', error);
      return null;
    }
  }
}
