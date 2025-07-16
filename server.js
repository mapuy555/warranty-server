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

function createAdminClaimCard(claimId, orderId, reason, status) {
  return {
    type: "flex",
    altText: `รายการเคลม: ${orderId}`,
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "📋 รายการเคลม", weight: "bold", size: "lg" },
          { type: "text", text: `คำสั่งซื้อ: ${orderId}` },
          { type: "text", text: `เหตุผล: ${reason}` },
          { type: "text", text: `สถานะ: ${status}` },
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            style: "primary",
            action: {
              type: "postback",
              label: "✅ เสร็จสิ้น",
              data: `changeStatus|${claimId}|เคลมสำเร็จ`
            }
          },
          {
            type: "button",
            style: "secondary",
            margin: "md",
            action: {
              type: "postback",
              label: "❌ ปฏิเสธ",
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

    const regDoc = await db.collection("registrations").doc(orderId).get();
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
      const claimId = newClaimQuery.docs[0].id;
      const adminFlex = createAdminClaimCard(claimId, orderId, reason, "อยู่ระหว่างดำเนินการ");

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

// ✅ webhook สำหรับ postback จาก LINE
app.post("/webhook", async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
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

        await axios.post("https://api.line.me/v2/bot/message/push", {
          to: claimDoc.data().userId,
          messages: [{ type: "text", text: `📦 สถานะการเคลมอัปเดต: ${newStatus}` }]
        }, {
          headers: {
            "Authorization": `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
            "Content-Type": "application/json"
          }
        });

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

// ✅ Start Server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
