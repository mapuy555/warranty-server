require("dotenv").config(); // ต้องอยู่บรรทัดแรก

const express = require("express");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");
const axios = require("axios");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: "https://warranty-register-53b10.web.app"
}));
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
          { type: "text", text: `🗒️ คำสั่งซื้อ: ${data.orderId}` },
          { type: "text", text: `📍 ที่อยู่: ${data.address.line}, ${data.address.subDistrict}, ${data.address.district}, ${data.address.province} ${data.address.postcode}` },
          { type: "text", text: `🗓️ วันที่ลงทะเบียน: ${data.registeredAt}` },
          { type: "text", text: `⏳ หมดประกัน: ${data.warrantyUntil}` },
          { type: "separator", margin: "md" },
          { type: "text", text: `📦 รายการสินค้า: ${orderData.productName}` },
          { type: "text", text: `🗓️ วันที่สั่งซื้อ: ${formatDate(orderData.purchaseDate)}` }
        ]
      }
    }
  };
}

function createAdminClaimCard(claimId, orderId, reason, status, claimedAt, contact) {
  return {
    type: "flex",
    altText: `รายการเคลม: ${orderId}`,
    contents: {
      type: "bubble",
      size: "mega",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: "📋 รายการแจ้งเคลม",
            weight: "bold",
            size: "xl",
            color: "#1DB446"
          },
          {
            type: "separator",
            margin: "sm"
          },
          {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            margin: "md",
            contents: [
              { type: "text", text: `🆔 คำสั่งซื้อ: ${orderId}`, size: "sm", wrap: true },
              { type: "text", text: `👤 ผู้แจ้ง: ${contact}`, size: "sm", wrap: true },
              { type: "text", text: `📅 วันที่แจ้ง: ${claimedAt}`, size: "sm" },
              { type: "text", text: `📌 เหตุผล: ${reason}`, size: "sm", wrap: true },
              { type: "text", text: `📦 สถานะ: ${status}`, size: "sm", color: "#FF6F00" }
            ]
          }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#06C755", // เขียว LINE
            action: {
              type: "postback",
              label: "✅ เคลมสำเร็จ",
              data: `changeStatus|${claimId}|เคลมสำเร็จ`
            }
          },
          {
            type: "button",
            style: "secondary",
            color: "#DD2C00", // แดง
            action: {
              type: "postback",
              label: "❌ ไม่อนุมัติ",
              data: `changeStatus|${claimId}|ไม่อนุมัติ`
            }
          }
        ]
      }
    }
  };
}


// ✅ LIFF ID
app.get("/api/liff-id", (req, res) => {
  res.json({ liffId: process.env.LIFF_ID });
});

// ✅ Save LINE user
app.post("/api/user", async (req, res) => {
  try {
    const { userId, displayName, pictureUrl } = req.body;
    if (!userId) return res.status(400).json({ message: "userId is required" });

    await db.collection("users").doc(userId).set({
      userId,
      displayName,
      pictureUrl,
      lastSeen: admin.firestore.Timestamp.now()
    }, { merge: true });

    res.status(200).json({ message: "✅ บันทึกข้อมูลผู้ใช้เรียบร้อย" });
  } catch (error) {
    console.error("❌ Error saving user profile:", error);
    res.status(500).json({ message: "ไม่สามารถบันทึกข้อมูลผู้ใช้ได้" });
  }
});

// ✅ ดึงคำสั่งซื้อ
app.get("/api/order/:orderId", async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const orderDoc = await db.collection("orders").doc(orderId).get();

    if (!orderDoc.exists) {
      return res.status(404).json({ message: "❌ ไม่พบคำสั่งซื้อ" });
    }

    const data = orderDoc.data();
    data.purchaseDateFormatted = formatDate(data.purchaseDate);
    return res.status(200).json(data);
  } catch (error) {
    console.error("❌ Error fetching order:", error);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงคำสั่งซื้อ" });
  }
});

// ✅ ลงทะเบียนสินค้า
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
    const warrantyUntil = calculateWarrantyUntil(7);

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
        "Authorization": `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
      }
    });

    res.status(200).json({ message: "✅ ลงทะเบียนสำเร็จ" });
  } catch (error) {
    console.error("❌ Error on /api/register:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในระบบ" });
  }
});

// ✅ ตรวจสอบสถานะลงทะเบียนและเคลม
app.get("/api/check-status/:orderId", async (req, res) => {
  try {
    const orderId = req.params.orderId;

    console.log("🔍 เข้ามาเช็คสถานะ orderId:", orderId);

    const regDoc = await db.collection("registrations").doc(orderId).get();

    console.log("📦 ตรวจสอบ registration:", orderId, "=> exists:", regDoc.exists);

    const claimsQuery = await db.collection("claims")
      .where("orderId", "==", orderId)
      .orderBy("claimedAt", "desc")
      .get();

    const registration = regDoc.exists ? regDoc.data() : null;
    const claims = [];
    claimsQuery.forEach(doc => {
      claims.push({ id: doc.id, ...doc.data() });
    });

    if (!registration && claims.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูล" });
    }

    return res.status(200).json({ registration, claims });
  } catch (error) {
    console.error("❌ Error on /api/check-status:", error);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดในระบบ" });
  }
});


// ✅ เคลมสินค้า
app.post("/api/claim", async (req, res) => {
  try {
    const { userId, orderId, reason, contact } = req.body;
    if (!userId || !orderId || !reason || !contact) {
      return res.status(400).json({ message: "กรุณากรอกข้อมูลให้ครบถ้วน" });
    }

    const orderDoc = await db.collection("orders").doc(orderId).get();
    if (!orderDoc.exists) {
      return res.status(404).json({ message: "❌ ไม่พบคำสั่งซื้อ" });
    }

    const regDoc = await db.collection("registrations").doc(orderId).get();
    if (!regDoc.exists) {
      return res.status(400).json({ message: "⛔ ยังไม่ได้ลงทะเบียนสินค้านี้" });
    }

    const regData = regDoc.data();
    const warrantyUntil = new Date(regData.warrantyUntil);
    const today = new Date();

    if (today > warrantyUntil) {
      return res.status(400).json({ message: `⚠️ หมดประกันวันที่ ${regData.warrantyUntil}` });
    }

    await db.collection("claims").add({
      userId,
      orderId,
      reason,
      contact,
      status: "อยู่ระหว่างดำเนินการ",
      claimedAt: admin.firestore.Timestamp.now()
    });

    const newClaimQuery = await db.collection("claims")
      .where("userId", "==", userId)
      .where("orderId", "==", orderId)
      .orderBy("claimedAt", "desc")
      .limit(1)
      .get();

    if (!newClaimQuery.empty) {
      const claimDoc = newClaimQuery.docs[0];
      const claimId = newClaimQuery.docs[0].id;

      const claimData = claimDoc.data();
      const claimedAtDate = claimData.claimedAt.toDate(); // ✅ แปลงเป็น Date
      const claimedAtStr = claimedAtDate.toISOString().split("T")[0]; // ✅ แปลงเป็น string วันที่ เช่น 2025-07-16

      const adminFlex = createAdminClaimCard(claimId, orderId, reason, "อยู่ระหว่างดำเนินการ", claimedAtStr, contact);


      await axios.post("https://api.line.me/v2/bot/message/push", {
        to: process.env.ADMIN_USER_IDS,
        messages: [adminFlex]
      }, {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
        }
      });
    }

    const messages = [
      {
        type: "text",
        text: `📢 ระบบได้รับการแจ้งเคลมของคุณแล้ว\nคำสั่งซื้อ: ${orderId}\nเหตุผล: ${reason}\nทีมงานจะติดต่อกลับภายใน 1-2 วันทำการ`
      },
      {
        type: "flex",
        altText: "กรุณาส่งรูปหลักฐานผ่านแชทนี้",
        contents: {
          type: "bubble",
          body: {
            type: "box",
            layout: "vertical",
            contents: [
              { type: "text", text: "📷 กรุณาส่งรูปหลักฐานการเคลม", weight: "bold", wrap: true },
              { type: "text", text: "เช่น:\n• รูปสินค้ามีปัญหา\n• กล่องสินค้า\n• ใบเสร็จ\nส่งผ่านแชทนี้ได้เลยครับ", size: "sm", wrap: true }
            ]
          }
        }
      }
    ];

    await axios.post("https://api.line.me/v2/bot/message/push", {
      to: userId,
      messages
    }, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
      }
    });

    res.status(200).json({ message: "✅ ส่งคำร้องเคลมสำเร็จ" });
  } catch (error) {
    console.error("❌ Error on /api/claim:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการแจ้งเคลม" });
  }
});

async function handleSendClaimList(replyToken) {
  try {
    const snapshot = await db.collection("claims")
      .orderBy("claimedAt", "desc")
      .limit(10)
      .get();

    if (snapshot.empty) {
      await axios.post("https://api.line.me/v2/bot/message/reply", {
        replyToken,
        messages: [{ type: "text", text: "📭 ไม่มีรายการเคลมในระบบ" }]
      }, {
        headers: {
          "Authorization": `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
          "Content-Type": "application/json"
        }
      });
      return;
    }

    const bubbles = [];
    snapshot.forEach(doc => {
      const d = doc.data();
      const claimedAtStr = d.claimedAt.toDate().toISOString().split("T")[0];
      const card = createAdminClaimCard(doc.id, d.orderId, d.reason, d.status, claimedAtStr, d.contact);
      bubbles.push(card.contents);
    });

    const carousel = {
      type: "flex",
      altText: "📋 รายการเคลมล่าสุด",
      contents: {
        type: "carousel",
        contents: bubbles
      }
    };

    await axios.post("https://api.line.me/v2/bot/message/reply", {
      replyToken,
      messages: [carousel]
    }, {
      headers: {
        "Authorization": `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      }
    });

  } catch (err) {
    console.error("❌ Error in handleSendClaimList:", err);
  }
}


// ✅ webhook สำหรับ postback จาก LINE
app.post("/webhook", async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    // ✅ 1. รับข้อความจากแอดมิน เช่น "ดูรายการเคลม"
    if (event.type === "message" && event.message.type === "text") {
      const userMessage = event.message.text.trim();
      const userId = event.source.userId;

      if (process.env.ADMIN_USER_IDS.split(",").includes(userId)) {
        if (userMessage === "ดูรายการเคลม" || userMessage.toLowerCase() === "claim list") {
          await handleSendClaimList(event.replyToken);
          continue;
        }
      }
    }

    // ✅ 2. เมื่อแอดมินกด postback เปลี่ยนสถานะ
    if (event.type === "postback" && event.postback.data.startsWith("changeStatus")) {
      const [_, claimId, newStatus] = event.postback.data.split("|");

      try {
        const claimRef = db.collection("claims").doc(claimId);
        const claimDoc = await claimRef.get();
        if (!claimDoc.exists) continue;

        await claimRef.update({
          status: newStatus,
          statusUpdatedAt: admin.firestore.Timestamp.now(),
        });

        // แจ้งกลับผู้ใช้
        await axios.post("https://api.line.me/v2/bot/message/push", {
          to: claimDoc.data().userId,
          messages: [{ type: "text", text: `📦 สถานะการเคลมอัปเดต: ${newStatus}` }]
        }, {
          headers: {
            "Authorization": `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
            "Content-Type": "application/json"
          }
        });

        // ตอบกลับแอดมิน
        await axios.post("https://api.line.me/v2/bot/message/reply", {
          replyToken: event.replyToken,
          messages: [{ type: "text", text: "✅ เปลี่ยนสถานะเรียบร้อย" }]
        }, {
          headers: {
            "Authorization": `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
            "Content-Type": "application/json"
          }
        });

      } catch (err) {
        console.error("❌ postback error:", err);
      }
    }
  }

  res.status(200).send("OK");
});

// ✅ API ส่ง firebaseConfig แบบปลอดภัย (ไม่ใส่ key ลับ)
app.get("/api/firebase-config", (req, res) => {
  res.json({
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID
  });
});


// ✅ Start Server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
