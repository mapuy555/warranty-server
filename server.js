app.use((req, res, next) => {
  console.log(`👉 ${req.method} ${req.url}`);
  next();
});


require("dotenv").config(); // ต้องอยู่บรรทัดแรก

const express = require("express");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");
const axios = require("axios");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: true }));
app.use(bodyParser.json());

// 🔐 Firebase Admin Init จาก Environment Variables (Base64)
const serviceAccount = JSON.parse(
  Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8")
);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

// ✅ Helper
function calculateWarrantyUntil(days) {
  const today = new Date();
  today.setDate(today.getDate() + days);
  return today.toISOString().split("T")[0];
}
function formatDate(dateField) {
  try {
    return dateField.toDate().toISOString().split("T")[0];
  } catch {
    return "-";
  }
}

// ✅ API: ลงทะเบียนสินค้า
app.post("/api/register", async (req, res) => {
  const { orderId, productName, serialNumber, purchaseDate, customerName, contact, userId } = req.body;

  if (!orderId || !productName || !serialNumber || !purchaseDate || !userId) {
    return res.status(400).json({ error: "ข้อมูลไม่ครบถ้วน" });
  }

  const regDoc = db.collection("registrations").doc(orderId);
  const doc = await regDoc.get();
  if (doc.exists) {
    return res.status(400).json({ error: "คำสั่งซื้อนี้ลงทะเบียนไปแล้ว" });
  }

  const warrantyUntil = calculateWarrantyUntil(365); // รับประกัน 1 ปี
  await regDoc.set({
    orderId,
    productName,
    serialNumber,
    purchaseDate,
    customerName,
    contact,
    userId,
    registeredAt: admin.firestore.Timestamp.now(),
    warrantyUntil,
  });

  // ตอบกลับ Flex Message ไปยัง LINE
  await axios.post("https://api.line.me/v2/bot/message/push", {
    to: userId,
    messages: [
      {
        type: "flex",
        altText: "ลงทะเบียนรับประกันสำเร็จ",
        contents: {
          type: "bubble",
          body: {
            type: "box",
            layout: "vertical",
            spacing: "md",
            contents: [
              { type: "text", text: "📦 ลงทะเบียนสำเร็จ!", weight: "bold", size: "xl" },
              { type: "text", text: `🔖 สินค้า: ${productName}` },
              { type: "text", text: `🪪 S/N: ${serialNumber}` },
              { type: "text", text: `📅 วันที่ซื้อ: ${purchaseDate}` },
              { type: "text", text: `✅ รับประกันถึง: ${warrantyUntil}` },
            ],
          },
        },
      },
    ],
  }, {
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
  });

  res.json({ message: "ลงทะเบียนสำเร็จ" });
});

// ✅ API: แจ้งเคลมสินค้า
app.post("/api/claim", async (req, res) => {
  const { orderId, reason, contact, userId } = req.body;

  if (!orderId || !reason || !userId) {
    return res.status(400).json({ error: "ข้อมูลไม่ครบถ้วน" });
  }

  const claimRef = db.collection("claims").doc(orderId);
  const doc = await claimRef.get();
  if (doc.exists) {
    return res.status(400).json({ error: "มีการแจ้งเคลมไปแล้ว" });
  }

  await claimRef.set({
    orderId,
    reason,
    contact,
    userId,
    status: "อยู่ระหว่างดำเนินการ",
    claimedAt: admin.firestore.Timestamp.now(),
  });

  // ตอบกลับข้อความ LINE
  await axios.post("https://api.line.me/v2/bot/message/push", {
    to: userId,
    messages: [
      {
        type: "text",
        text: `📨 ระบบได้รับคำขอเคลมของคุณแล้ว\nคำสั่งซื้อ: ${orderId}\nสถานะ: อยู่ระหว่างดำเนินการ`,
      },
    ],
  }, {
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
  });

  res.json({ message: "แจ้งเคลมสำเร็จ" });
});

// ✅ API: ตรวจสอบสถานะ
app.get("/api/check-status", async (req, res) => {
  const { orderId } = req.query;
  if (!orderId) return res.status(400).json({ error: "ต้องระบุ orderId" });

  const regDoc = await db.collection("registrations").doc(orderId).get();
  const claimDoc = await db.collection("claims").doc(orderId).get();

  if (!regDoc.exists && !claimDoc.exists) {
    return res.status(404).json({ error: "ไม่พบข้อมูล" });
  }

  const result = {};
  if (regDoc.exists) {
    const r = regDoc.data();
    result.registration = {
      productName: r.productName,
      serialNumber: r.serialNumber,
      purchaseDate: r.purchaseDate,
      warrantyUntil: r.warrantyUntil,
      registeredAt: formatDate(r.registeredAt),
    };
  }

  if (claimDoc.exists) {
    const c = claimDoc.data();
    result.claim = {
      reason: c.reason,
      contact: c.contact,
      status: c.status,
      claimedAt: formatDate(c.claimedAt),
    };
  }

  res.json(result);
});

// ✅ LINE Webhook: ตอบกลับเมื่อพิมพ์ "หลังบ้าน"
app.post("/webhook", async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    const userId = event.source.userId;

    // ✅ ตรวจว่าพิมพ์คำว่า "หลังบ้าน"
    if (event.type === "message" && event.message.type === "text") {
      const text = event.message.text.trim().toLowerCase();

      const adminList = process.env.ADMIN_USER_IDS.split(",");
      if (text === "หลังบ้าน" && adminList.includes(userId)) {
        const flexMessage = {
          type: "flex",
          altText: "Admin Dashboard",
          contents: {
            type: "bubble",
            body: {
              type: "box",
              layout: "vertical",
              spacing: "md",
              contents: [
                {
                  type: "text",
                  text: "🔐 Admin Dashboard",
                  weight: "bold",
                  size: "lg",
                  color: "#000000"
                },
                {
                  type: "text",
                  text: "เข้าจัดการลงทะเบียนและเคลมสินค้า",
                  size: "sm",
                  color: "#666666",
                  wrap: true
                },
                {
                  type: "button",
                  style: "primary",
                  action: {
                    type: "uri",
                    label: "เปิดหลังบ้าน",
                    uri: "https://liff.line.me/165xxxxxxxxx" // 👉 เปลี่ยนเป็น LIFF URL ของคุณ
                  }
                }
              ]
            }
          }
        };

        await axios.post("https://api.line.me/v2/bot/message/push", {
          to: userId,
          messages: [flexMessage]
        }, {
          headers: {
            Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
            "Content-Type": "application/json"
          }
        });
      }
    }
  }

  res.sendStatus(200);
});


// ✅ Start Server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
