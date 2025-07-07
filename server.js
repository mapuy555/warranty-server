require("dotenv").config(); // ⬅️ ควรอยู่บรรทัดแรกเสมอ

const express = require("express");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");
const axios = require("axios");
const cors = require("cors"); // ✅ หากต้องให้ frontend cross origin

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors()); // ✅ เปิด CORS หากมี frontend แยกโดเมน
app.use(bodyParser.json());



// 🔐 Firebase Admin Init จาก Environment Variables
const serviceAccount = JSON.parse(
  Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});


const db = admin.firestore();

// ✅ Helper: คำนวณวันหมดประกัน
function calculateWarrantyUntil(days) {
  const today = new Date();
  today.setDate(today.getDate() + days);
  return today.toISOString().split("T")[0];
}

// ✅ Helper: สร้าง Flex Message
function createFlexMessage(data, orderData) {
  return {
    type: "flex",
    altText: "ลงทะเบียนสำเร็จ ✅",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "✅ ลงทะเบียนสำเร็จ", weight: "bold", size: "lg", color: "#06C755" },
          { type: "separator", margin: "md" },
          { type: "text", text: `📌 ชื่อ: ${data.name}` },
          { type: "text", text: `📞 เบอร์: ${data.phone}` },
          { type: "text", text: `📧 อีเมล: ${data.email}` },
          { type: "text", text: `🧾 คำสั่งซื้อ: ${data.orderId}` },
          { type: "text", text: `📍 ที่อยู่: ${data.address.line}, ${data.address.subDistrict}, ${data.address.district}, ${data.address.province} ${data.address.postcode}` },
          { type: "text", text: `📅 วันที่ลงทะเบียน: ${data.registeredAt}` },
          { type: "text", text: `⏳ หมดประกัน: ${data.warrantyUntil}` },
          { type: "separator", margin: "md" },
          { type: "text", text: `📦 รายการสินค้า: ${orderData.productName}` },
          { type: "text", text: `📅 วันที่สั่งซื้อ: ${orderData.purchaseDate}` }
        ]
      }
    }
  };
}

// ✅ Endpoint: ส่ง LIFF ID ให้ฝั่ง client แบบปลอดภัย
app.get("/api/liff-id", (req, res) => {
  res.json({ liffId: process.env.LIFF_ID });
});

// ✅ Endpoint: ลงทะเบียนสินค้า
app.post("/api/register", async (req, res) => {
  try {
    const { userId, name, phone, email, orderId, address } = req.body;

    const existing = await db.collection("registrations").doc(orderId).get();
    if (existing.exists) {
      return res.status(400).json({ message: "🔁 คำสั่งซื้อนี้ลงทะเบียนแล้ว" });
    }

    const orderDoc = await db.collection("orders").doc(orderId).get();
    if (!orderDoc.exists) {
      return res.status(404).json({ message: "❌ ไม่พบคำสั่งซื้อ" });
    }
    const orderData = orderDoc.data();

    const registeredAt = new Date();
    const warrantyDays = 7;
    const warrantyUntil = calculateWarrantyUntil(warrantyDays);

    await db.collection("registrations").doc(orderId).set({
      userId,
      name,
      phone,
      email,
      orderId,
      address,
      registeredAt: admin.firestore.Timestamp.fromDate(registeredAt),
      warrantyUntil,
    });

    const flexMessage = createFlexMessage({
      userId,
      name,
      phone,
      email,
      orderId,
      address,
      registeredAt: registeredAt.toISOString().split("T")[0],
      warrantyUntil,
    }, orderData);

    await axios.post("https://api.line.me/v2/bot/message/push", {
      to: userId,
      messages: [flexMessage],
    }, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      },
    });

    res.status(200).json({ message: "✅ ลงทะเบียนสำเร็จ" });

  } catch (error) {
    console.error("❌ Error:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในระบบ" });
  }
});

// ✅ Start Server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});


