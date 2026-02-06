export class LinkAccountDto {
  /**
   * LINE User ID ที่ได้จาก LINE Login
   */
  lineUserId: string;

  /**
   * Verification Token ที่ได้จากการเริ่มต้นการเชื่อมต่อ
   */
  verificationToken: string;
}
