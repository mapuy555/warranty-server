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

const AFTERSHIP_API_KEY = process.env.AFTERSHIP_API_KEY; // ใส่ใน .env
const AFTERSHIP_BASE_URL = "https://api.aftership.com/v4";

async function getTrackingInfo(slug, trackingNumber) {
  try {
    const response = await axios.get(
      `${AFTERSHIP_BASE_URL}/trackings/${slug}/${trackingNumber}`,
      {
        headers: {
          "aftership-api-key": AFTERSHIP_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    const tracking = response.data.data.tracking;

    // 📦 คืนวันที่ Delivered ถ้ามี
    const deliveredDate = tracking?.delivered_at;
    return deliveredDate ? new Date(deliveredDate) : null;

  } catch (error) {
    console.error("❌ AfterShip API error:", error.response?.data || error.message);
    return null;
  }
}

// 🔧 ฟังก์ชันคำนวณวันหมดประกันจาก AfterShip
async function getWarrantyFromTracking(slug, trackingNumber) {
  try {
    const res = await axios.get(`https://api.aftership.com/v4/trackings/${slug}/${trackingNumber}`, {
      headers: {
        "aftership-api-key": process.env.AFTERSHIP_API_KEY,
        "Content-Type": "application/json"
      }
    });

    const checkpoints = res.data?.data?.tracking?.checkpoints || [];
    const deliveredCheckpoint = checkpoints.find(cp => cp.tag === "Delivered");

    if (deliveredCheckpoint?.checkpoint_time) {
      const deliveredDate = new Date(deliveredCheckpoint.checkpoint_time);
      const warrantyUntil = new Date(deliveredDate);
      warrantyUntil.setDate(warrantyUntil.getDate() + 7);

      return { deliveredAt: deliveredDate, warrantyUntil };
    }
  } catch (err) {
    console.warn("⚠️ ไม่สามารถดึงข้อมูลจาก AfterShip:", err.message);
  }

  return null; // ถ้าไม่เจอ
}



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
    altText: "ยืนยันการลงทะเบียนรับประกันสินค้า",
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "📦 ลงทะเบียนสำเร็จ",
            weight: "bold",
            size: "lg",
            color: "#1DB446"
          }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "text",
            text: `ชื่อ: ${data.name}`,
            wrap: true
          },
          {
            type: "text",
            text: `เบอร์: ${data.phone}`,
            wrap: true
          },
          {
            type: "text",
            text: `อีเมล: ${data.email}`,
            wrap: true
          },
          {
            type: "text",
            text: `เลขคำสั่งซื้อ: ${data.orderId}`,
            wrap: true
          },
          {
            type: "text",
            text: `ที่อยู่: ${data.address}`,
            wrap: true
          },
          {
            type: "separator",
            margin: "md"
          },
          {
            type: "text",
            text: `📅 วันที่ลงทะเบียน: ${data.registeredAt}`,
            size: "sm",
            color: "#999999"
          },
          {
            type: "text",
            text: `🛡️ รับประกันถึง: ${data.warrantyUntil}`,
            size: "sm",
            color: "#ff5555",
            weight: "bold"
          },
          ...(orderData?.items?.map((item, i) => ({
            type: "box",
            layout: "baseline",
            spacing: "sm",
            margin: "md",
            contents: [
              {
                type: "text",
                text: `สินค้า ${i + 1}:`,
                flex: 1,
                size: "sm"
              },
              {
                type: "text",
                text: `${item.productName} (${item.quantity})`,
                flex: 4,
                size: "sm",
                wrap: true
              }
            ]
          })) || [])
        ]
      },
      styles: {
        header: {
          backgroundColor: "#F0FDF4"
        }
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

    // 🔍 เช็กใน Shopee
    let orderDoc = await db.collection("orders").doc(orderId).get();
    if (orderDoc.exists) {
      const data = orderDoc.data();
      data.purchaseDateFormatted = formatDate(data.purchaseDate);
      return res.status(200).json({ ...data, source: "shopee" });
    }

    // 🔍 ถ้ายังไม่เจอ ลองใน TikTok
    orderDoc = await db.collection("orders_tiktok").doc(orderId).get();
    if (orderDoc.exists) {
      const data = orderDoc.data();
      data.purchaseDateFormatted = formatDate(data.purchaseDate);
      return res.status(200).json({ ...data, source: "tiktok" });
    }

    return res.status(404).json({ message: "❌ ไม่พบคำสั่งซื้อ" });
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

    // 🔍 ค้นหา order จาก Shopee หรือ TikTok
    let orderDoc = await db.collection("orders").doc(orderId).get();
    let source = "shopee";

    if (!orderDoc.exists) {
      orderDoc = await db.collection("orders_tiktok").doc(orderId).get();
      source = "tiktok";
    }

    if (!orderDoc.exists) {
      return res.status(404).json({ message: "❌ ไม่พบคำสั่งซื้อ" });
    }

    const orderData = orderDoc.data();

    // 📦 พยายามดึงวันจัดส่งจาก AfterShip
    let warrantyUntil = null;
    let deliveredAt = null;

    if (orderData.trackingNumber && orderData.slug) {
      const result = await getWarrantyFromTracking(orderData.slug, orderData.trackingNumber);
      if (result) {
        deliveredAt = result.deliveredAt;
        warrantyUntil = result.warrantyUntil;
      }
    }

    // 🔁 fallback หากไม่มี tracking info ให้กำหนด default 7 วัน
    if (!warrantyUntil) {
      const fallback = new Date();
      fallback.setDate(fallback.getDate() + 7);
      warrantyUntil = fallback;
    }

    const registeredAt = new Date();

    // 📝 บันทึกลง Firestore
    await db.collection("registrations").doc(orderId).set({
      userId,
      name,
      phone,
      email,
      orderId,
      address,
      registeredAt: admin.firestore.Timestamp.fromDate(registeredAt),
      warrantyUntil: admin.firestore.Timestamp.fromDate(warrantyUntil),
      deliveredAt: deliveredAt ? admin.firestore.Timestamp.fromDate(deliveredAt) : null, // ✅ เพิ่มตรงนี้
      source,
    });

    // ✉️ สร้าง Flex Message
    const flexMessage = createFlexMessage({
      userId,
      name,
      phone,
      email,
      orderId,
      address,
      registeredAt: registeredAt.toISOString().split("T")[0],
      warrantyUntil: warrantyUntil.toISOString().split("T")[0],
    }, orderData);

    // 📤 ส่งกลับ LINE
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
// ✅ เคลมสินค้า
app.post("/api/claim", async (req, res) => {
  try {
    const { userId, orderId, reason, contact } = req.body;
    if (!userId || !orderId || !reason || !contact) {
      return res.status(400).json({ message: "กรุณากรอกข้อมูลให้ครบถ้วน" });
    }

    // 🔍 ค้นหา order จาก Shopee หรือ TikTok
    let orderDoc = await db.collection("orders").doc(orderId).get();
    if (!orderDoc.exists) {
      orderDoc = await db.collection("orders_tiktok").doc(orderId).get();
    }
    if (!orderDoc.exists) {
      return res.status(404).json({ message: "❌ ไม่พบคำสั่งซื้อ" });
    }

    const orderData = orderDoc.data(); // ✅ ใช้ orderData เพื่ออ่าน source

    // 🔍 ตรวจสอบการลงทะเบียน
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

    // ✅ เพิ่ม source ลง claims
  await db.collection("claims").add({
  userId,
  orderId,
  reason,
  contact,
  status: "อยู่ระหว่างดำเนินการ",
  claimedAt: admin.firestore.Timestamp.now(),
  source: orderData.source || "ไม่ระบุ",

  // ✅ เพิ่มข้อมูลจากการลงทะเบียน
  name: regData.name || "-",
  email: regData.email || "-",
  phone: regData.phone || "-",
  address: regData.address || "-",
  registeredAt: regData.registeredAt || null,
  warrantyUntil: regData.warrantyUntil || "-"
});


    // ✅ สร้าง Flex Message สำหรับแจ้งเตือน
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
      const claimedAtStr = claimData.claimedAt.toDate().toISOString().split("T")[0];

      const adminFlex = createAdminClaimCard(claimId, orderId, reason, "อยู่ระหว่างดำเนินการ", claimedAtStr, contact);
      // ❌ ไม่ส่งหาแอดมินตรงนี้ (ปิดไว้แล้ว)
    }

    // ✅ ตอบกลับผู้ใช้ผ่าน LINE
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


app.get("/api/claims", async (req, res) => {
  try {
    const snapshot = await db.collection("claims").orderBy("claimedAt", "desc").get();
    const claims = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        claimedAtFormatted: formatDate(data.claimedAt)
      };
    });
    res.json({ claims });
  } catch (err) {
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลการเคลม" });
  }
});


app.patch("/api/claims/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  console.log("📦 PATCH /api/claims/:id/status", { id, status });

  try {
    const docRef = db.collection("claims").doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({ message: "ไม่พบรายการเคลมนี้" });
    }

    await docRef.update({ status });
    res.json({ message: "✅ อัปเดตสถานะเรียบร้อย" });
  } catch (err) {
    console.error("❌ PATCH status error:", err);
    res.status(500).json({ message: "❌ อัปเดตสถานะไม่สำเร็จ" });
  }
});


app.get("/api/registrations", async (req, res) => {
  try {
    const snapshot = await db.collection("registrations").orderBy("registeredAt", "desc").get();
    const registrations = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        registeredAtFormatted: formatDate(data.registeredAt)
      };
    });
    res.json({ registrations });
  } catch (err) {
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลลงทะเบียน" });
  }
});


app.delete("/api/claims/:id", async (req, res) => {
  try {
    await db.collection("claims").doc(req.params.id).delete();
    res.json({ message: "✅ ลบรายการเคลมสำเร็จ" });
  } catch (err) {
    res.status(500).json({ message: "❌ ลบไม่สำเร็จ" });
  }
});

app.delete("/api/registrations/:orderId", async (req, res) => {
  try {
    await db.collection("registrations").doc(req.params.orderId).delete();
    res.json({ message: "✅ ลบรายการลงทะเบียนสำเร็จ" });
  } catch (err) {
    res.status(500).json({ message: "❌ ลบไม่สำเร็จ" });
  }
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

const multer = require("multer");
const XLSX = require("xlsx");
const upload = multer({ storage: multer.memoryStorage() });

function parseExcelDate(value) {
  if (!value) return null;

  if (typeof value === "number") {
    return new Date(Math.round((value - 25569) * 86400 * 1000));
  }

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value)) {
    const iso = value.replace(" ", "T") + ":00"; // ➜ ISO format
    return new Date(iso);
  }

  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function mapShippingProviderToSlug(name) {
  const normalized = name.toLowerCase().trim();

  if (normalized.includes("flash")) return "flash-express";
  if (normalized.includes("spx")) return "spx";
  if (normalized.includes("kerry")) return "kerry-express";
  if (normalized.includes("j&t")) return "jtexpress";
  if (normalized.includes("j&t express")) return "jtexpress";
  if (normalized.includes("ninja")) return "ninjavan";
  if (normalized.includes("best")) return "best-express";
  if (normalized.includes("ไปรษณีย์") || normalized.includes("post")) return "thailand-post";

  return "unknown";
}


app.post("/api/upload-orders", upload.single("file"), async (req, res) => {
  try {
    const buffer = req.file.buffer;
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    let added = 0;
    let skipped = 0;

    function extractSlugFromShopee(shippingOption) {
      if (!shippingOption) return null;
      if (shippingOption.includes("Flash")) return "flash";
      if (shippingOption.includes("SPX")) return "spx";
      if (shippingOption.includes("J&T")) return "jnt-express";
      return null;
    }

    for (const row of data) {
      const orderId = row["หมายเลขคำสั่งซื้อ"];
      if (!orderId) continue;

      const orderRef = db.collection("orders").doc(orderId);
      const existing = await orderRef.get();

      const trackingNumber = row["*หมายเลขติดตามพัสดุ"]?.toString().trim() || "";
      const shippingOption = row["ตัวเลือกการจัดส่ง"] || "";
      const slug = extractSlugFromShopee(shippingOption);

      const item = {
        productName: row["ชื่อสินค้า"] || "",
        quantity: row["จำนวน"] || 1,
        sku: row["เลขอ้างอิง SKU (SKU Reference No.)"] || "",
        price: row["ราคาขาย"] || 0,
      };

      if (existing.exists) {
        await orderRef.update({
          items: admin.firestore.FieldValue.arrayUnion(item)
        });
        skipped++;
        continue;
      }

      await orderRef.set({
        orderId,
        name: row["ชื่อผู้รับ"] || "",
        status: row["สถานะการสั่งซื้อ"] || "",
        purchaseDate: parseExcelDate(row["เวลาการชำระสินค้า"]),
        items: [item],
        trackingNumber,
        slug,
        source: "shopee",
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      added++;
    }

    res.status(200).json({
      message: `✅ อัปโหลดแล้ว ${added} รายการ, ⏩ ข้าม ${skipped} รายการ (ซ้ำ)`
    });
  } catch (error) {
    console.error("❌ Error uploading orders:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการอัปโหลดคำสั่งซื้อ" });
  }
});



// ✅ แจ้งเตือนสถานะเคลมผ่าน Flex Message
app.post("/api/notify-status-change", async (req, res) => {
  try {
    const { claimId, status } = req.body;

    const claimDoc = await db.collection("claims").doc(claimId).get();
    if (!claimDoc.exists) {
      return res.status(404).json({ message: "ไม่พบรายการเคลม" });
    }

    const claimData = claimDoc.data();
    const { userId, orderId, reason, claimedAt, contact } = claimData;

    const claimedAtStr = claimedAt.toDate().toISOString().split("T")[0];

    const flex = createAdminClaimCard(claimId, orderId, reason, status, claimedAtStr, contact);

    await axios.post("https://api.line.me/v2/bot/message/push", {
      to: userId,
      messages: [
        {
          type: "text",
          text: `📢 สถานะการเคลมของคุณถูกอัปเดตเป็น: ${status}`
        },
        flex
      ]
    }, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
      }
    });

    res.status(200).json({ message: "📤 แจ้งเตือนสำเร็จ" });
  } catch (err) {
    console.error("❌ Error on /api/notify-status-change:", err);
    res.status(500).json({ message: "❌ ไม่สามารถแจ้งเตือนสถานะได้" });
  }
});

app.get("/api/registrations/:orderId", async (req, res) => {
  const { orderId } = req.params;
  try {
    const doc = await db.collection("registrations").doc(orderId).get();
    if (doc.exists) {
      res.json({ registered: true, data: doc.data() });
    } else {
      res.json({ registered: false });
    }
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ สำหรับหน้า register
app.get("/api/liff-id-register", (req, res) => {
  res.json({ liffId: process.env.LIFF_ID_REGISTER });
});

// ✅ สำหรับหน้า claim
app.post("/api/upload-orders-tiktok", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "ไม่ได้แนบไฟล์" });

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });

    const batch = db.batch();
    let successCount = 0;

    const slugMap = {
      "J&T Express": "jnt-express",
      "Flash Express": "flash",
      "SPX Express": "spx"
    };

    rows.forEach((row) => {
      const orderId = row["Order ID"]?.toString().trim();
      if (orderId === "Platform unique order ID." || !orderId) return;

      const name = row["Recipient"]?.toString().trim() || "-";
      const productName = row["Product Name"]?.toString().trim() || "-";
      const status = row["Order Status"]?.toString().trim() || "-";
      const trackingNumber = row["Tracking ID"]?.toString().trim() || "";
      const slug = slugMap[row["Shipping Provider Name"]] || null;

      // 🔄 แปลงวันที่
      let purchaseDate = null;
      try {
        const raw = row["Paid Time"];
        let date = null;
        if (typeof raw === "number") {
          date = new Date((raw - 25569) * 86400 * 1000);
        } else if (typeof raw === "string") {
          if (raw.includes("/")) {
            const [d, m, yAndTime] = raw.split("/");
            const [y, time] = yAndTime.split(" ");
            date = new Date(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T${time}`);
          } else {
            date = new Date(raw.replace(" ", "T"));
          }
        }
        if (date && !isNaN(date)) {
          purchaseDate = admin.firestore.Timestamp.fromDate(date);
        }
      } catch (err) {
        console.warn("⚠️ แปลง Paid Time ไม่ได้:", row["Paid Time"]);
      }

      const ref = db.collection("orders_tiktok").doc(orderId);
      batch.set(ref, {
        orderId,
        name,
        status,
        trackingNumber,
        slug,
        purchaseDate,
        items: [
          {
            productName,
            quantity: parseInt(row["Quantity"]) || 1,
          },
        ],
        source: "tiktok",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      successCount++;
    });

    await batch.commit();
    res.json({
      message: `อัปโหลดสำเร็จทั้งหมด ${successCount} รายการ ✅`,
    });
  } catch (err) {
    console.error("⛔ Upload TikTok Error:", err);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการอัปโหลด TikTok" });
  }
});


app.post("/api/check-delivery-date", async (req, res) => {
  const { orderId, source } = req.body;
  const collection = source === "tiktok" ? "orders_tiktok" : "orders";
  const orderRef = db.collection(collection).doc(orderId);
  const orderDoc = await orderRef.get();

  if (!orderDoc.exists) {
    return res.status(404).json({ message: "ไม่พบคำสั่งซื้อ" });
  }

  const data = orderDoc.data();
  const { trackingNumber, slug } = data;

  if (!trackingNumber || !slug || slug === "unknown") {
    return res.status(400).json({ message: "ไม่มีข้อมูลขนส่งหรือยังไม่รองรับ" });
  }

  const deliveredDate = await getTrackingInfo(slug, trackingNumber);

  if (!deliveredDate) {
    return res.status(404).json({ message: "ยังไม่มีข้อมูลวันจัดส่งสำเร็จ" });
  }

  // 🧮 คำนวณวันหมดประกัน (เช่น 365 วัน)
  const warrantyUntil = new Date(deliveredDate);
  warrantyUntil.setDate(warrantyUntil.getDate() + 365);

  await orderRef.update({
    deliveredDate: admin.firestore.Timestamp.fromDate(deliveredDate),
    warrantyUntil: admin.firestore.Timestamp.fromDate(warrantyUntil),
  });

  res.json({
    message: "อัปเดตวันหมดประกันสำเร็จ ✅",
    deliveredDate,
    warrantyUntil,
  });
});



//fihfrrji
// ✅ Start Server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
