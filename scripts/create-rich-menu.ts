import axios from 'axios';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function createRichMenu() {
  try {
    const accessToken = process.env.LINE_ACCESS_TOKEN;

    if (!accessToken) {
      console.error('❌ Error: LINE_ACCESS_TOKEN not found in .env file');
      process.exit(1);
    }

    console.log('📲 Creating Rich Menu...');

    const res = await axios.post(
      'https://api.line.me/v2/bot/richmenu',
      {
        size: { width: 2500, height: 1686 },
        selected: true,
        name: 'IT Support Menu',
        chatBarText: 'เมนูแจ้งซ่อม',
        areas: [
          {
            bounds: { x: 0, y: 0, width: 1250, height: 843 },
            action: { type: 'uri', label: '🔧 แจ้งซ่อม', uri: 'https://rp-trr-client-internship.vercel.app/repairs/liff?action=create' },
          },
          {
            bounds: { x: 1250, y: 0, width: 1250, height: 843 },
            action: { type: 'uri', label: '📋 ตรวจสอบสถานะ', uri: 'https://rp-trr-client-internship.vercel.app/repairs/liff?action=status' },
          },
          {
            bounds: { x: 0, y: 843, width: 1250, height: 843 },
            action: { type: 'uri', label: '❓ คำถามที่พบบ่อย', uri: 'https://rp-trr-client-internship.vercel.app/repairs/liff?action=faq' },
          },
          {
            bounds: { x: 1250, y: 843, width: 1250, height: 843 },
            action: { type: 'uri', label: '📞 ติดต่อเรา', uri: 'https://rp-trr-client-twxn.vercel.app/repairs/liff?action=contact' },
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      },
    );

    const richMenuId = res.data.richMenuId;
    console.log('✅ Rich Menu created successfully!');
    console.log(`📌 Rich Menu ID: ${richMenuId}`);
    console.log('\n💡 Add this to your .env file:');
    console.log(`LINE_RICH_MENU_ID=${richMenuId}`);

    return richMenuId;
  } catch (error: any) {
    console.error('❌ Error creating Rich Menu:');
    if (error.response?.data) {
      console.error(error.response.data);
    } else {
      console.error(error.message);
    }
    process.exit(1);
  }
}

createRichMenu();
