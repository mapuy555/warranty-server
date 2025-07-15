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
    console.error("❌ Error on /api/claim:", error.response?.data || error.message || error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในระบบ" });
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
//test thongnee
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

    // ✅ 2. ดึง claim ล่าสุดของ order/user นี้มาแจ้งแอดมิน
const newClaimQuery = await db.collection("claims")
  .where("userId", "==", userId)
  .where("orderId", "==", orderId)
  .orderBy("claimedAt", "desc")
  .limit(1)
  .get();

if (!newClaimQuery.empty) {
  const claimId = newClaimQuery.docs[0].id;

  const adminFlex = createAdminClaimCard(
    claimId, orderId, reason, "อยู่ระหว่างดำเนินการ"
  );

  await axios.post("https://api.line.me/v2/bot/message/push", {
    to: process.env.ADMIN_LINE_USERID,
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
          {
            type: "text",
            text: "📷 กรุณาส่งรูปหลักฐานการเคลม",
            weight: "bold",
            wrap: true,
          },
          {
            type: "text",
            text: "เช่น:\n• รูปสินค้ามีปัญหา\n• กล่องสินค้า\n• ใบเสร็จ\nส่งผ่านแชทนี้ได้เลยครับ",
            size: "sm",
            wrap: true
          }
        ]
      }
    }
  }
];

    await axios.post("https://api.line.me/v2/bot/message/push", {
  to: userId,
  messages: messages
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

// ✅ ตรวจสอบสถานะ
app.get("/api/check-status/:orderId", async (req, res) => {
  const orderId = req.params.orderId;

  try {
    const registrationDoc = await db.collection("registrations").doc(orderId).get();
    const claimQuery = await db.collection("claims")
      .where("orderId", "==", orderId)
      .orderBy("claimedAt", "desc")
      .limit(1)
      .get();

    const result = {
      orderId,
      registered: false,
      claimed: false,
    };

    if (registrationDoc.exists) {
      const reg = registrationDoc.data();
      result.registered = true;
      result.name = reg.name || "-";
      result.warrantyUntil = reg.warrantyUntil || "-";
      result.registeredAt = reg.registeredAt ? formatDate(reg.registeredAt) : "-";
    }

    if (!claimQuery.empty) {
      const claim = claimQuery.docs[0].data();
      result.claimed = true;
      result.claimStatus = claim.status || "อยู่ระหว่างดำเนินการ";
      result.claimDate = claim.claimedAt ? formatDate(claim.claimedAt) : "-";
      result.reason = claim.reason || "-";
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error("❌ Error on /api/check-status:", error);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดในการตรวจสอบสถานะ" });
  }
});

// ✅ เปลี่ยนสถานะเคลมและแจ้งเตือน LINE
app.post("/api/notify-status-change", async (req, res) => {
  try {
    const { claimId, newStatus } = req.body;

    if (!claimId || !newStatus) {
      return res.status(400).json({ message: "กรุณาระบุ claimId และ newStatus" });
    }

    const claimRef = db.collection("claims").doc(claimId);
    const claimDoc = await claimRef.get();

    if (!claimDoc.exists) {
      return res.status(404).json({ message: "ไม่พบรายการเคลมนี้" });
    }

    const claimData = claimDoc.data();

    // อัปเดตสถานะใหม่
    await claimRef.update({
      status: newStatus,
      statusUpdatedAt: admin.firestore.Timestamp.now()
    });

    // ส่งข้อความแจ้งเตือนกลับไปยังลูกค้า
    const message = {
      type: "text",
      text: `📦 สถานะการเคลมของคุณถูกอัปเดตแล้ว\nคำสั่งซื้อ: ${claimData.orderId}\nสถานะใหม่: ${newStatus}`
    };

    await axios.post("https://api.line.me/v2/bot/message/push", {
      to: claimData.userId,
      messages: [message],
    }, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      },
    });

    res.status(200).json({ message: "✅ อัปเดตสถานะและแจ้งเตือนสำเร็จ" });

  } catch (error) {
    console.error("❌ Error on /api/notify-status-change:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการอัปเดตสถานะ" });
  }
});

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
        layout: "horizontal",
        contents: [
          {
            type: "button",
            style: "primary",
            action: {
              type: "postback",
              label: "✅ เสร็จสิ้น",
              data: `changeStatus|${claimId}|เสร็จสิ้น`
            }
          },
          {
            type: "button",
            style: "secondary",
            action: {
              type: "postback",
              label: "กำลังดำเนินการ",
              data: `changeStatus|${claimId}|อยู่ระหว่างดำเนินการ`
            }
          }
        ]
      }
    }
  };
}


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
          messages: [{ type: "text", text: `📦 สถานะการเคลมอัปเดต: ${newStatus}` }],
        }, {
          headers: {
            Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
            "Content-Type": "application/json"
          }
        });

        // แจ้งแอดมิน (ตอบกลับทันที)
        await axios.post("https://api.line.me/v2/bot/message/reply", {
          replyToken: event.replyToken,
          messages: [{ type: "text", text: "✅ เปลี่ยนสถานะเรียบร้อย" }],
        }, {
          headers: {
            Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
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

app.get("/api/send-admin-claims", async (req, res) => {
  try {
    const snapshot = await db.collection("claims")
      .orderBy("claimedAt", "desc")
      .limit(5)
      .get();

    const messages = [];
    snapshot.forEach(doc => {
      const d = doc.data();
      messages.push(createAdminClaimCard(doc.id, d.orderId, d.reason, d.status));
    });

    await axios.post("https://api.line.me/v2/bot/message/push", {
      to: process.env.ADMIN_LINE_USERID,
      messages: messages
    }, {
      headers: {
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      }
    });

    res.status(200).json({ message: "✅ ส่งรายการให้แอดมินแล้ว" });
  } catch (err) {
    console.error("❌ Error sending admin claims:", err);
    res.status(500).json({ message: "❌ ไม่สามารถส่งให้แอดมินได้" });
  }
});


// ✅ Start Server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
