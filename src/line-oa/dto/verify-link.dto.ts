export class VerifyLinkDto {
  /**
   * LINE User ID
   */
  lineUserId: string;

  /**
   * Verification Token
   */
  verificationToken: string;

  /**
   * Display Name จาก LINE Profile
   */
  displayName?: string;

  /**
   * Picture URL จาก LINE Profile
   */
  pictureUrl?: string;
}
