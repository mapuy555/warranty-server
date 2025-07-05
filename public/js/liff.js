liff.init({ liffId: "YOUR_LIFF_ID" }).then(() => {
  if (!liff.isLoggedIn()) {
    liff.login();
  } else {
    liff.getProfile().then(profile => {
      console.log("LINE userId:", profile.userId);
      // เก็บ userId นี้ไปใช้ต่อ
    });
  }
});
