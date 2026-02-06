export class LineWebhookDto {
  events: LineEvent[];
}

export class LineEvent {
  type: string; // follow, unfollow, message, postback, etc.
  timestamp: number;
  source: {
    type: string;
    userId: string;
    groupId?: string;
    roomId?: string;
  };
  replyToken?: string;
  message?: {
    type: string;
    id: string;
    text?: string;
  };
  postback?: {
    data: string;
    params?: any;
  };
}
