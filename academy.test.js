"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createECDH, createHmac, randomBytes, randomUUID } = require("node:crypto");
const { once } = require("node:events");
const { createServer, createAdmin } = require("./server");
const { stripPhotoMetadata } = require("./academy-photo");
const { generateRequestDetails } = require("web-push");

test("un estudiante entra al aula solo después de la aprobación manual de su comprobante", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ivanna-academy-test-"));
  const adminCredentials = { username: "admin-prueba", password: "Una clave solo de prueba" };
  createAdmin(adminCredentials.username, adminCredentials.password, dataDir);
  let server;
  let origin;
  let admin;
  let student;
  const sentEmails = [];
  const sentPush = [];
  const wahaRequests = [];
  const plugRequests = [];
  let attachmentAvailable = true;
  const liveRooms = new Set();
  const start = async () => {
    server = createServer({
      dataDir, sendPaymentEmail: async (job) => { sentEmails.push(job); },
      sendPush: async (subscription, payload, options) => {
        const details = generateRequestDetails(subscription, payload, options);
        sentPush.push({ message: JSON.parse(payload), details });
      },
      wahaTransport: async (url, request) => {
        assert.equal(request.headers["X-Api-Key"], "waha-test-key");
        wahaRequests.push({ path: url.pathname, method: request.method, body: request.body && JSON.parse(request.body) });
        if (url.pathname === "/api/sessions/default") return { status: 200, result: { name: "default", status: "WORKING" } };
        if (url.pathname === "/api/sendFile" && !attachmentAvailable) return { status: 501 };
        return { status: 201, result: { id: "wamid-test" } };
      },
      plugNmeetTransport: async (url, request) => {
        assert.equal(request.headers["API-KEY"], "plug-test-key");
        assert.equal(request.headers["HASH-SIGNATURE"], createHmac("sha256", "plug-test-secret").update(request.body).digest("hex"));
        const action = url.pathname.slice(6);
        const input = JSON.parse(request.body);
        plugRequests.push({ action, input });
        const result = { status: true };
        if (action === "room/isRoomActive") result.is_active = liveRooms.has(input.room_id);
        if (action === "room/create") liveRooms.add(input.room_id);
        if (action === "room/end") liveRooms.delete(input.room_id);
        if (action === "room/getJoinToken") result.token = input.user_info.is_admin ? "moderator-token" : "student-token";
        if (action === "recording/fetch") result.result = {
          total_recordings: 2,
          recordings_list: [
            { room_id: input.room_ids[0], record_id: "our-recording", metadata: { title: "Nuestra grabación" }, file_size: 1000, creation_time: 1795137700 },
            { room_id: "another-room", record_id: "another-recording" },
          ],
        };
        if (action === "recording/getDownloadToken") result.token = "private-download";
        return { status: 200, result };
      },
    }).listen(0, "127.0.0.1");
    await once(server, "listening");
    origin = `http://127.0.0.1:${server.address().port}`;
  };
  const send = (route, { method = "GET", body, cookie, headers = {} } = {}) => fetch(origin + route, {
    method,
    redirect: "manual",
    headers: {
      ...(method !== "GET" ? { Origin: origin } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined || body instanceof FormData ? {} : { "Content-Type": Buffer.isBuffer(body) ? "application/octet-stream" : "application/json" }),
      ...headers,
    },
    body: Buffer.isBuffer(body) || body instanceof FormData || body === undefined ? body : JSON.stringify(body),
  });
  const upload = (route, body, cookie = admin) => send(route, { method: "POST", body, cookie });
  const update = (route, body, cookie = admin) => send(route, { method: "PUT", body, cookie });
  const sessionCookie = (response) => response.headers.get("set-cookie").split(";")[0];
  const image = fs.readFileSync(path.join(__dirname, "assets", "hero-purple.jpeg"));
  const video = Buffer.from("000000146674797069736f6d0000000069736f6d000000086d646174", "hex");
  const metadata = Buffer.from("Metadato privado de prueba");
  const jpegComment = Buffer.alloc(4);
  jpegComment.writeUInt16BE(0xfffe);
  jpegComment.writeUInt16BE(metadata.length + 2, 2);
  const imageWithMetadata = Buffer.concat([image.subarray(0, 2), jpegComment, metadata, image.subarray(2)]);

  try {
    await start();
    assert.equal((await (await send("/api/academy")).json()).course, null);
    assert.equal((await send("/api/admin/academy")).status, 401);
    assert.equal((await send("/api/academy/lesson")).status, 401);
    assert.match(await (await send("/")).text(), /id="subscripciones"[\s\S]*id="community-form" method="post" action="\/api\/academy\/register"/);
    const legacyPage = await fetch(`${origin}/academia`, { redirect: "manual" });
    assert.equal(legacyPage.status, 303);
    assert.equal(legacyPage.headers.get("location"), "/mi-espacio");
    const space = await send("/mi-espacio");
    const spaceHtml = await space.text();
    assert.match(spaceHtml, /<h1>Mi espacio<\/h1>/);
    assert.match(spaceHtml, /data-dock="perfil"[\s\S]*data-dock="mis-cursos"[\s\S]*data-dock="feed"[\s\S]*data-dock="shop"/);
    assert.match(spaceHtml, /id="mis-cursos"[\s\S]*id="feed"[\s\S]*id="shop"/);
    assert.match(spaceHtml, /<p>Muy pronto<\/p>/);
    const manifest = await send("/manifest.webmanifest");
    assert.match(manifest.headers.get("content-type"), /application\/manifest\+json/);
    const app = await manifest.json();
    assert.equal(app.display, "standalone");
    assert.equal(app.start_url, "/mi-espacio");
    for (const icon of app.icons) {
      const png = Buffer.from(await (await send(icon.src)).arrayBuffer());
      assert.equal(icon.sizes, `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`);
    }
    assert.equal((await send("/academy-notifications-sw.js")).status, 200);
    assert.equal((await send("/push-keys.json")).status, 404);
    assert.match(space.headers.get("permissions-policy"), /display-capture=\(\)/);
    assert.equal(space.headers.get("x-frame-options"), "DENY");
    const adminLogin = await upload("/api/admin/login", adminCredentials);
    assert.equal(adminLogin.status, 200);
    admin = sessionCookie(adminLogin);

    const qrFile = await upload("/api/admin/academy/qr", image);
    assert.equal(qrFile.status, 201);
    const qr = (await qrFile.json()).id;
    const invalidVideo = Buffer.from(video);
    invalidVideo.writeUInt32BE(video.length + 4);
    assert.equal((await upload("/api/admin/academy/video", invalidVideo)).status, 415);
    const videoFile = await upload("/api/admin/academy/video", video);
    assert.equal(videoFile.status, 201);
    const videoId = (await videoFile.json()).id;
    const course = {
      title: "Primer curso de prueba",
      description: "Descripción para verificar el proceso.",
      price: "119,50",
      instructions: "Instrucciones de prueba para el QR.",
      qr,
      lessonTitle: "Preparación de la piel",
      lessonText: "Contenido privado de la lección.",
      video: videoId,
    };
    assert.equal((await update("/api/admin/academy/course", { course: { ...course, qr: "" }, revision: 0, publish: true })).status, 400);
    assert.equal((await update("/api/admin/academy/course", { course, revision: 0 })).status, 200);
    assert.equal((await (await send("/api/academy")).json()).course, null);
    assert.equal((await update("/api/admin/academy/course", { course, revision: 1, publish: true })).status, 200);
    const catalog = await (await send("/api/academy")).json();
    assert.deepEqual(catalog.course, { title: course.title, description: course.description, cents: 11950 });
    assert.equal((await send(`/api/admin/academy/image/${qr}`)).status, 401);

    const studentCredentials = { name: "Estudiante de prueba", email: "estudiante@example.test", password: "Una clave de estudiante" };
    const registrationDetails = { ...studentCredentials, age: "24", interest: "Maquillaje profesional" };
    const registration = { ...registrationDetails, country: "BO", department: "Santa Cruz", whatsapp: "7000-0000", whatsappConsent: true };
    assert.equal((await upload("/api/academy/register", { ...registration, whatsapp: "+59170000000" })).status, 400);
    assert.equal((await upload("/api/academy/register", { ...registration, country: "ZZ" })).status, 400);
    assert.equal((await upload("/api/academy/register", { ...registration, department: "Santa Cruz de la Sierra" })).status, 400);
    assert.equal((await upload("/api/academy/register", { ...registration, interest: "Opción desconocida" })).status, 400);
    const signup = await upload("/api/academy/register", registration);
    assert.equal(signup.status, 201);
    assert.match(signup.headers.get("set-cookie"), /HttpOnly; SameSite=Strict; Max-Age=2592000/);
    student = sessionCookie(signup);
    assert.ok(!fs.readFileSync(path.join(dataDir, "academy.json"), "utf8").includes(student.split("=")[1]));
    assert.deepEqual((await signup.json()).student, { name: studentCredentials.name, email: studentCredentials.email });
    assert.equal((await upload("/api/academy/register", registration)).status, 409);
    const secondSignup = await upload("/api/academy/register", { ...registration, name: "Otra estudiante", email: "autora-feed@example.test" });
    assert.equal(secondSignup.status, 201);
    const secondStudent = sessionCookie(secondSignup);

    const postForm = new FormData();
    postForm.set("requestId", randomUUID());
    postForm.set("text", "Mi práctica de maquillaje.");
    postForm.append("photos", new Blob([imageWithMetadata], { type: "image/jpeg" }), "look.jpg");
    assert.equal((await upload("/api/academy/feed", postForm, secondStudent)).status, 201);
    const { posts: [post] } = await (await send("/api/academy/feed")).json();
    assert.equal(post.author.name, "Otra");
    assert.equal(post.own, false);
    const { participants: feedRanking, examples } = await (await send("/api/academy/ranking")).json();
    assert.deepEqual(feedRanking.map(({ rank, name, points, url }) => [rank, name, points, url]), [[1, "Otra", 1, post.author.url]]);
    assert.deepEqual(examples, []);
    const feedProfile = post.author.url.replace("/perfil/", "/api/academy/profiles/");
    assert.equal((await send(post.author.url)).status, 200);
    const { profile: participantProfile } = await (await send(feedProfile)).json();
    assert.equal(participantProfile.displayName, "Otra");
    assert.ok(!Object.hasOwn(participantProfile, "email"));
    const postPhoto = await send(post.photos[0]);
    assert.equal(postPhoto.status, 200);
    assert.ok(!Buffer.from(await postPhoto.arrayBuffer()).includes(metadata));
    assert.equal((await upload("/api/academy/feed", postForm, secondStudent)).status, 200);
    assert.equal((await (await send("/api/academy/feed")).json()).posts.length, 1);
    const postPath = `/api/academy/feed/posts/${post.id}`;
    assert.equal((await update(`${postPath}/heart`, { loved: true }, "")).status, 401);
    assert.deepEqual(await (await update(`${postPath}/heart`, { loved: true }, student)).json(), { hearts: 1, loved: true });
    assert.deepEqual(await (await update(`${postPath}/heart`, { loved: false }, student)).json(), { hearts: 0, loved: false });
    assert.equal((await upload(`${postPath}/comments`, { text: "Me encanta.", requestId: randomUUID() }, student)).status, 201);
    const { comments: [comment] } = await (await send(`${postPath}/comments`)).json();
    const moderatePost = `/api/admin/academy/feed/posts/${post.id}`;
    assert.equal((await update(`${moderatePost}/comments/${comment.id}`, { hidden: true })).status, 200);
    assert.equal((await (await send(`${postPath}/comments`)).json()).comments.length, 0);
    assert.equal((await update(moderatePost, { hidden: true })).status, 200);
    const emptyRanking = await (await send("/api/academy/ranking")).json();
    assert.deepEqual(emptyRanking.participants, []);
    assert.equal(emptyRanking.examples.length, 5);
    const example = emptyRanking.examples[0];
    assert.equal((await send(example.url)).status, 200);
    const { profile: sampleProfile } = await (await send(example.url.replace("/perfil/", "/api/academy/profiles/"))).json();
    assert.equal(sampleProfile.name, example.name);
    assert.equal(sampleProfile.demo, true);
    assert.equal((await send(feedProfile)).status, 404);
    assert.equal((await send(post.photos[0])).status, 404);
    assert.equal((await send(post.photos[0], { cookie: admin })).status, 200);
    assert.equal((await update(moderatePost, { hidden: false })).status, 200);
    assert.equal((await send(postPath, { method: "DELETE", cookie: student })).status, 403);
    assert.equal((await send(postPath, { method: "DELETE", cookie: secondStudent })).status, 200);
    assert.equal((await send(post.photos[0])).status, 404);

    const pagedPosts = [];
    for (let i = 1; i <= 5; i += 1) {
      const fields = new FormData();
      fields.set("requestId", randomUUID());
      fields.set("text", `Publicación de paginación ${i}`);
      const saved = await upload("/api/academy/feed", fields, secondStudent);
      assert.equal(saved.status, 201);
      pagedPosts.unshift((await saved.json()).post.id);
    }
    assert.equal((await send("/api/academy/feed?limit=0")).status, 400);
    const firstPage = await (await send("/api/academy/feed?limit=3")).json();
    const lastPage = await (await send(`/api/academy/feed?limit=3&before=${firstPage.next}`)).json();
    assert.deepEqual(firstPage.posts.map(({ id }) => id), pagedPosts.slice(0, 3));
    assert.deepEqual(lastPage.posts.map(({ id }) => id), pagedPosts.slice(3));
    assert.equal(lastPage.next, null);
    for (const id of pagedPosts) {
      assert.equal((await send(`/api/academy/feed/posts/${id}`, { method: "DELETE", cookie: secondStudent })).status, 200);
    }
    for (let index = 0; index < 3; index += 1) {
      const fields = new FormData();
      fields.set("requestId", randomUUID());
      fields.set("text", "Publicación para comprobar el límite diario");
      const result = await upload("/api/academy/feed", fields, secondStudent);
      assert.equal(result.status, index < 2 ? 201 : 429);
      if (result.ok) {
        const { post: saved } = await result.json();
        assert.equal((await send(`/api/academy/feed/posts/${saved.id}`, { method: "DELETE", cookie: secondStudent })).status, 200);
      }
    }

    const { key } = await (await send("/api/academy/notifications/key", { cookie: student })).json();
    assert.equal(key.length, 87);
    assert.equal((await send("/api/academy/notifications/key")).status, 401);
    const receiver = createECDH("prime256v1");
    const subscription = {
      endpoint: "https://fcm.googleapis.com/fcm/send/ivanna-test",
      keys: { p256dh: receiver.generateKeys().toString("base64url"), auth: randomBytes(16).toString("base64url") },
    };
    const subscriptionRoute = "/api/academy/notifications/subscription";
    assert.equal((await update(subscriptionRoute, { ...subscription, endpoint: "https://another.example.test/push" }, student)).status, 400);
    assert.equal((await update(subscriptionRoute, subscription, student)).status, 200);
    const inbox = (cookie) => send("/api/academy/notifications", { cookie }).then((response) => response.json()).then(({ entries }) => entries);
    assert.equal((await send("/api/admin/academy", { cookie: student })).status, 401);
    assert.equal((await send("/api/academy/lesson", { cookie: student })).status, 403);
    const enrollment = await upload("/api/academy/order", {}, student);
    assert.equal(enrollment.status, 201);
    const order = (await enrollment.json()).order;
    assert.equal(order.cents, 11950);
    assert.equal((await (await upload("/api/academy/order", {}, student)).json()).order.id, order.id);
    assert.equal((await send("/api/academy/order/qr", { cookie: student })).headers.get("content-type"), "image/jpeg");

    assert.equal((await update("/api/admin/academy/course", { course: { ...course, price: "150", lessonText: "Borrador privado sin publicar." }, revision: 2 })).status, 200);
    assert.equal((await upload("/api/academy/order/receipt", Buffer.from("archivo inválido"), student)).status, 415);
    assert.equal((await upload("/api/academy/order/receipt", Buffer.alloc(0), student)).status, 400);
    assert.equal((await upload("/api/academy/order/receipt", image, student)).status, 200);
    assert.equal((await inbox(student))[0].url, `/mi-espacio#aviso-${order.id}`);
    assert.equal((await inbox(secondStudent)).length, 0);
    assert.equal((await inbox()).length, 0);
    assert.equal((await upload("/api/academy/order/receipt", image, student)).status, 409);
    const adminState = await (await send("/api/admin/academy", { cookie: admin })).json();
    assert.equal(adminState.metrics.pending, 1);
    assert.deepEqual(adminState.students.find(({ email }) => email === studentCredentials.email), {
      name: studentCredentials.name, email: studentCredentials.email,
      profile: { country: "BO", department: "Santa Cruz", age: 24, whatsapp: "+59170000000", interest: "Maquillaje profesional", whatsappConsent: true },
    });
    assert.equal(adminState.orders[0].cents, 11950);
    const reviewRoute = `/api/admin/academy/orders/${order.id}`;
    assert.equal((await send(`${reviewRoute}/receipt`, { cookie: student })).status, 401);
    assert.match((await send(`${reviewRoute}/receipt`, { cookie: admin })).headers.get("content-disposition"), /attachment/);
    assert.equal((await update(reviewRoute, { decision: "rejected", note: "", receipt: adminState.orders[0].receipt })).status, 400);
    assert.equal((await update(reviewRoute, { decision: "rejected", note: "Falta el número de operación.", receipt: adminState.orders[0].receipt })).status, 200);
    assert.match((await (await send("/api/academy", { cookie: student })).json()).order.note, /número de operación/);
    assert.equal((await upload("/api/academy/order/receipt", image, student)).status, 200);
    assert.equal((await update(reviewRoute, { decision: "approved", receipt: adminState.orders[0].receipt })).status, 409);
    const next = await (await send("/api/admin/academy", { cookie: admin })).json();
    assert.equal((await update(reviewRoute, { decision: "approved", receipt: next.orders[0].receipt })).status, 400);
    const approval = await update(reviewRoute, { decision: "approved", receipt: next.orders[0].receipt, bankReference: "Banco 123-456" });
    assert.equal(approval.status, 200);
    const afterApproval = await approval.json();
    assert.equal(afterApproval.orders[0].bankReference, "BANCO123456");
    assert.equal(afterApproval.metrics.monthCents, 11950);
    assert.deepEqual(afterApproval.orders[0].paymentHistory.map(({ status }) => status), ["awaiting_receipt", "submitted", "rejected", "submitted", "approved"]);
    assert.equal((await update(reviewRoute, { decision: "approved", receipt: next.orders[0].receipt })).status, 409);
    assert.deepEqual(sentEmails.map(({ status }) => status), ["submitted", "submitted", "approved"]);
    assert.equal(new Set(sentEmails.map(({ id }) => id)).size, 3);
    assert.ok(sentEmails.every(({ email, title }) => email === studentCredentials.email && title === course.title));
    assert.equal((await inbox(student))[0].url, `/mi-espacio#inscripcion-${order.id}`);
    assert.deepEqual(sentPush.map(({ message }) => message.title), [
      "Verificando comprobante", "Corrige el comprobante", "Verificando comprobante", "Tu curso está listo para ver",
    ]);
    assert.ok(sentPush.every(({ details }) => details.headers["Content-Encoding"] === "aes128gcm"));
    const news = { title: "Nuevo taller", body: "Ya puedes ver las novedades en https://example.test/taller.", destination: "courses", push: true };
    assert.equal((await upload("/api/admin/academy/news", news, student)).status, 401);
    const newsForm = new FormData();
    for (const [key, value] of Object.entries({ ...news, push: "on" })) newsForm.set(key, value);
    newsForm.append("photos", new Blob([image], { type: "image/jpeg" }), "taller.jpg");
    const publication = await upload("/api/admin/academy/news", newsForm);
    assert.equal(publication.status, 201);
    const { entries: [publishedNews] } = await publication.json();
    const officialPostId = publishedNews.postId;
    assert.equal((await inbox())[0].url, `/mi-espacio#publicacion-${officialPostId}`);
    const { posts: [officialPost] } = await (await send("/api/academy/feed")).json();
    assert.equal(officialPost.id, officialPostId);
    assert.equal(officialPost.author.name, "Ivanna Saldaña");
    assert.equal(officialPost.news.title, news.title);
    assert.equal(officialPost.news.destination.url, "/#subscripciones");
    assert.equal(officialPost.text, news.body);
    assert.equal((await send(officialPost.photos[0])).status, 200);
    assert.equal(sentPush.at(-1).message.title, news.title);
    const newsModeration = `/api/admin/academy/feed/posts/${officialPostId}`;
    assert.equal((await update(newsModeration, { hidden: true })).status, 200);
    assert.equal((await inbox()).length, 0);
    assert.equal((await update(newsModeration, { hidden: false })).status, 200);
    const { videoUrl, ...lesson } = await (await send("/api/academy/lesson", { cookie: student })).json();
    assert.deepEqual(lesson, { title: course.lessonTitle, text: course.lessonText, hasVideo: true });
    assert.equal((await send("/api/academy/lesson/video", { cookie: student })).status, 403);
    assert.equal((await send(videoUrl, { cookie: student, headers: { "Sec-Fetch-Dest": "document" } })).status, 403);
    assert.equal((await send(`${videoUrl}&download=1`, { cookie: student })).status, 403);
    const partial = await send(videoUrl, { cookie: student, headers: { Range: "bytes=4-7", "Sec-Fetch-Dest": "video" } });
    assert.equal(partial.status, 206);
    assert.equal(await partial.text(), "ftyp");
    assert.equal(partial.headers.get("cache-control"), "private, no-store");
    assert.equal((await send(videoUrl, { cookie: student, headers: { Range: "bytes=1000-" } })).status, 416);

    const foreignSignup = await upload("/api/academy/register", { ...registrationDetails, email: "otra@example.test", country: "BR", city: "São Paulo", whatsapp: "11 90000-0000", whatsappConsent: false });
    assert.equal(foreignSignup.status, 201);
    const other = sessionCookie(foreignSignup);
    assert.equal((await send("/api/academy/lesson/video", { cookie: other })).status, 403);
    assert.equal((await (await send("/api/academy", { cookie: other })).json()).order, null);
    assert.equal((await upload("/api/admin/academy/close", { revision: 3 })).status, 200);
    assert.equal((await upload("/api/academy/order", {}, other)).status, 409);
    assert.equal((await send("/api/academy/lesson", { cookie: student })).status, 200);

    await new Promise((resolve) => server.close(resolve));
    await start();
    const remembered = await (await send("/api/academy", { cookie: student })).json();
    assert.equal(remembered.student.email, studentCredentials.email);
    assert.equal(remembered.order.status, "approved");
    assert.equal((await send("/api/academy/lesson", { cookie: student })).status, 200);
    assert.equal((await upload("/api/academy/logout", {}, student)).status, 200);
    assert.equal((await inbox(student)).some(({ id }) => id.startsWith("pago-")), false);
    const countBefore = sentPush.length;
    const adminAgain = await upload("/api/admin/login", adminCredentials);
    assert.equal((await upload("/api/admin/academy/news", { ...news, title: "Segundo taller" }, sessionCookie(adminAgain))).status, 201);
    assert.equal(sentPush.length, countBefore);
    assert.equal((await send("/api/academy/lesson", { cookie: student })).status, 401);
    const resumedAdmin = sessionCookie(await upload("/api/admin/login", adminCredentials));
    const students = (await (await send("/api/admin/academy", { cookie: resumedAdmin })).json()).students;
    assert.equal(students[0].profile.whatsapp, "+5511900000000");
    assert.equal(students[0].profile.whatsappConsent, false);
    const login = await upload("/api/academy/login", studentCredentials);
    assert.equal(login.status, 200);
    const access = await login.json();
    assert.equal(access.order.status, "approved");
    assert.equal(access.course, null);
    assert.equal((await send("/api/academy/lesson", { cookie: sessionCookie(login) })).status, 200);

    student = sessionCookie(login);
    admin = resumedAdmin;
    const liveUrl = "https://live.example.test/sala";
    const live = { ...course, title: "Masterclass de prueba", liveUrl };
    const plan = { ...course, title: "Esencial de prueba", lessonTitle: "Color" };
    assert.equal((await update("/api/admin/academy/course/live", { course: live, revision: 4, publish: true })).status, 200);
    assert.equal((await update("/api/admin/academy/course/esencial", { course: plan, revision: 5, publish: true })).status, 200);
    const publicCatalog = await (await send("/api/academy")).json();
    assert.deepEqual(publicCatalog.offers.map(({ id }) => id).sort(), ["esencial", "live"]);
    assert.ok(!JSON.stringify(publicCatalog).includes(liveUrl));
    assert.equal((await send("/academy-payment.js")).status, 200);
    const first = await (await upload("/api/academy/order", { offerId: "live" }, student)).json();
    const liveOrder = first.orders.find(({ offerId }) => offerId === "live");
    const second = await (await upload("/api/academy/order", { offerId: "esencial" }, student)).json();
    const planOrder = second.orders.find(({ offerId }) => offerId === "esencial");
    assert.equal(second.orders.length, 3);
    assert.notEqual(liveOrder.id, planOrder.id);
    const liveRoute = `/api/academy/orders/${liveOrder.id}`;
    const planRoute = `/api/academy/orders/${planOrder.id}`;
    assert.equal((await send(`${liveRoute}/live`, { cookie: student })).status, 403);
    assert.equal((await send(`${liveRoute}/qr`, { cookie: other })).status, 404);
    const qrDownload = await send(`${liveRoute}/qr?download=1`, { cookie: student });
    assert.equal(qrDownload.status, 200);
    assert.match(qrDownload.headers.get("content-disposition"), /attachment; filename="qr-pago\.jpg"/);
    assert.equal((await upload(`${liveRoute}/paid`, {}, student)).status, 400);
    assert.equal((await upload(`${liveRoute}/receipt`, image, student)).status, 200);
    const getReview = async (id) => (await (await send("/api/admin/academy", { cookie: admin })).json()).orders.find((item) => item.id === id);
    const pending = await getReview(liveOrder.id);
    assert.equal(pending.status, "submitted");
    assert.ok(pending.receipt);
    assert.ok(pending.submissionId);
    assert.equal((await upload(`${liveRoute}/paid`, {}, student)).status, 400);
    assert.equal((await getReview(liveOrder.id)).submissionId, pending.submissionId);
    const confirm = (id, submissionId, bankReference = `Banco-${id}`) =>
      update(`/api/admin/academy/orders/${id}`, { decision: "approved", submissionId, bankReference });
    assert.equal((await confirm(liveOrder.id, "revisión anterior")).status, 409);
    assert.equal((await confirm(liveOrder.id, pending.submissionId, "banco/123 456")).status, 409);
    assert.equal((await confirm(liveOrder.id, pending.submissionId)).status, 200);
    const liveAccess = await send(`${liveRoute}/live`, { cookie: student });
    assert.equal(liveAccess.status, 303);
    assert.equal(liveAccess.headers.get("location"), liveUrl);
    assert.equal((await send(`${liveRoute}/live`, { cookie: other })).status, 404);
    assert.equal((await send(`${planRoute}/lesson`, { cookie: student })).status, 403);
    assert.equal((await upload(`${planRoute}/receipt`, image, student)).status, 200);
    assert.equal((await confirm(planOrder.id, (await getReview(planOrder.id)).submissionId)).status, 200);
    const planAccess = await send(`${planRoute}/lesson`, { cookie: student });
    assert.equal(planAccess.status, 200);
    assert.equal((await planAccess.json()).title, plan.lessonTitle);

    const publicReviews = async () => (await (await send("/api/academy/reviews")).json()).reviews;
    assert.equal((await publicReviews()).length, 3);
    assert.ok((await publicReviews()).every(({ demo }) => demo));
    assert.equal((await send("/assets/avatar-generico.svg")).headers.get("content-type"), "image/svg+xml");
    assert.equal((await (await send("/api/academy", { cookie: other })).json()).profile.url, null);
    const review = { rating: 5, comment: "Me gustaron los ejercicios de color." };
    assert.equal((await upload(`${planRoute}/review`, review, student)).status, 409);
    assert.equal((await upload(`${planRoute}/complete`, {}, other)).status, 404);
    assert.equal((await upload(`${liveRoute}/complete`, {}, student)).status, 403);
    assert.equal((await upload(`${planRoute}/complete`, {}, student)).status, 409);
    const singleChapter = (await (await send(`${planRoute}/chapters`, { cookie: student })).json()).chapters[0];
    const singleComplete = await upload(`${planRoute}/chapters/${singleChapter.id}/seen`, { version: singleChapter.version }, student);
    assert.equal((await singleComplete.json()).orders.find(({ id }) => id === planOrder.id).completed, true);
    assert.equal((await upload(`${planRoute}/review`, { ...review, rating: 6 }, student)).status, 400);
    const reviewSubmission = await upload(`${planRoute}/review`, review, student);
    assert.equal(reviewSubmission.status, 201);
    assert.equal((await reviewSubmission.json()).orders.find(({ id }) => id === planOrder.id).reviewStatus, "pending");
    assert.equal((await upload(`${planRoute}/review`, review, student)).status, 409);
    assert.ok((await publicReviews()).every(({ demo }) => demo));
    const reviewAdmin = `/api/admin/academy/reviews/${planOrder.id}`;
    const approvedReview = { ...review, revision: 0, approve: true, name: "Estudiante", comment: "Me sirvieron los ejercicios de color." };
    assert.equal((await update(reviewAdmin, approvedReview, student)).status, 401);
    assert.equal((await update(reviewAdmin, approvedReview)).status, 200);
    const { profile: generic, ...publishedReview } = (await publicReviews())[0];
    assert.deepEqual(publishedReview, { course: plan.title, name: "Estudiante", rating: 5, comment: approvedReview.comment, demo: false });
    assert.equal(generic.avatar, null);
    assert.match(generic.url, /^\/perfil\/[a-f0-9]{32}$/);
    const profileApi = generic.url.replace("/perfil/", "/api/academy/profiles/");
    assert.equal((await send(generic.url)).status, 200);
    assert.equal((await send(`${profileApi}/avatar`)).status, 404);
    const profileForm = new FormData();
    profileForm.set("instagram", "@ivanna.prueba");
    profileForm.set("tiktok", "ivanna_prueba");
    profileForm.set("youtube", "@maquillajeñ");
    profileForm.set("specialty", "Maquillaje editorial");
    profileForm.set("avatar", new Blob([imageWithMetadata], { type: "image/jpeg" }), "foto.jpg");
    const anonymousSave = await send("/api/academy/profile", { method: "POST", body: profileForm });
    assert.equal(anonymousSave.status, 401);
    const invalidHandle = new FormData();
    invalidHandle.set("instagram", "https://otro.example/usuario");
    assert.equal((await upload("/api/academy/profile", invalidHandle, student)).status, 400);
    const badImage = new FormData();
    badImage.set("avatar", new Blob(["<svg/>"]), "no-es-foto.jpg");
    assert.equal((await upload("/api/academy/profile", badImage, student)).status, 415);
    const profileSave = await upload("/api/academy/profile", profileForm, student);
    assert.equal(profileSave.status, 200);
    const { profile } = await profileSave.json();
    assert.equal(profile.url, generic.url);
    assert.equal(profile.displayName, studentCredentials.name);
    assert.equal(profile.specialty, "Maquillaje editorial");
    assert.deepEqual(profile.socials.map(({ href }) => href), ["https://www.instagram.com/ivanna.prueba", "https://www.tiktok.com/@ivanna_prueba", "https://www.youtube.com/@maquillaje%C3%B1"]);
    assert.deepEqual((await (await send(profileApi)).json()).profile, profile);
    assert.deepEqual((await publicReviews())[0].profile, profile);
    assert.ok(!JSON.stringify(profile).includes(studentCredentials.email));
    const avatar = await send(profile.avatar);
    assert.equal(avatar.status, 200);
    assert.equal(avatar.headers.get("content-type"), "image/jpeg");
    const cleanPhoto = stripPhotoMetadata(image, "jpg");
    assert.deepEqual(Buffer.from(await avatar.arrayBuffer()), cleanPhoto);
    const avatarFile = new URL(profile.avatar, origin).searchParams.get("v");
    const avatarPath = path.join(dataDir, "academy-media", avatarFile);
    assert.deepEqual(fs.readFileSync(avatarPath), cleanPhoto);
    fs.writeFileSync(avatarPath, imageWithMetadata);
    assert.deepEqual(Buffer.from(await (await send(profile.avatar)).arrayBuffer()), cleanPhoto);
    const privateProfile = new FormData();
    privateProfile.set("visibility", "private");
    assert.equal((await upload("/api/academy/profile", privateProfile, student)).status, 200);
    assert.equal((await send(profileApi)).status, 404);
    assert.equal((await send(profile.avatar, { cookie: other })).status, 404);
    assert.equal((await send(profile.avatar, { cookie: student })).status, 200);
    assert.deepEqual((await publicReviews())[0].profile, { name: "Estudiante", displayName: "Estudiante", socials: [], url: null, avatar: null });
    profileForm.set("visibility", "public");
    profileForm.delete("avatar");
    assert.equal((await upload("/api/academy/profile", profileForm, student)).status, 200);
    assert.deepEqual((await (await send(profileApi)).json()).profile, profile);
    const otherProfile = new FormData();
    otherProfile.set("studentId", generic.url.split("/").at(-1));
    otherProfile.set("facebook", "otro.participante");
    assert.equal((await upload("/api/academy/profile", otherProfile, other)).status, 200);
    assert.deepEqual((await (await send(profileApi)).json()).profile, profile);
    const removeAvatar = new FormData();
    removeAvatar.set("removeAvatar", "1");
    removeAvatar.set("specialty", "");
    assert.equal((await upload("/api/academy/profile", removeAvatar, student)).status, 200);
    assert.equal((await send(profile.avatar)).status, 404);
    assert.deepEqual((await publicReviews())[0].profile, generic);
    assert.equal((await update(reviewAdmin, { ...approvedReview, revision: 1, rating: 4, approve: false })).status, 200);
    assert.equal((await publicReviews())[0].rating, 4);
    const remove = (route, revision) => send(route, { method: "DELETE", body: { revision }, cookie: admin });
    assert.equal((await remove(reviewAdmin, 1)).status, 409);
    assert.equal((await remove(reviewAdmin, 2)).status, 200);
    assert.equal((await remove("/api/admin/academy/reviews/demo-1", 0)).status, 200);
    await new Promise((resolve) => server.close(resolve));
    await start();
    assert.deepEqual((await publicReviews()).map(({ course }) => course), ["Editorial", "Artístico"]);
    assert.equal((await send(`${planRoute}/lesson`, { cookie: student })).status, 200);
    admin = sessionCookie(await upload("/api/admin/login", adminCredentials));
    const courseCatalog = (await (await send("/api/admin/academy", { cookie: admin })).json());
    const size = courseCatalog.catalog.length;
    const extra = { ...course, title: "Taller Especial de prueba", price: "180,50", cover: "purple" };
    const invalidCategory = await upload("/api/admin/academy/course", { category: "inexistente", revision: courseCatalog.revision, course: extra });
    assert.equal(invalidCategory.status, 400);
    const draftResponse = await upload("/api/admin/academy/course", { category: "special", revision: courseCatalog.revision, course: extra });
    assert.equal(draftResponse.status, 201);
    const saved = await draftResponse.json();
    assert.match(saved.savedOfferId, /^oferta-[a-f0-9]{32}$/);
    assert.equal(saved.catalog.length, size + 1);
    assert.equal(saved.catalog.find(({ id }) => id === saved.savedOfferId).category, "special");
    assert.ok(!(await (await send("/api/academy")).json()).offers.some(({ id }) => id === saved.savedOfferId));
    const publishedExtra = await update(`/api/admin/academy/course/${saved.savedOfferId}`, { revision: saved.revision, course: extra, publish: true });
    assert.equal(publishedExtra.status, 200);
    const afterExtra = await publishedExtra.json();
    const extraCard = (await (await send("/api/academy")).json()).offers.find(({ id }) => id === saved.savedOfferId);
    assert.deepEqual(extraCard, { id: saved.savedOfferId, title: extra.title, description: extra.description, category: "special", cents: 18050, cover: "purple", startsAt: "" });
    const extraOrder = await upload("/api/academy/order", { offerId: extraCard.id }, student);
    assert.equal(extraOrder.status, 201);
    assert.equal((await extraOrder.json()).orders.find(({ offerId }) => offerId === extraCard.id).cents, 18050);

    const newLive = { ...live, title: "Otro evento en vivo", startsAt: "2027-01-26T19:00", price: "95", cover: "purple" };
    const liveResponse = await upload("/api/admin/academy/course", { category: "live", revision: afterExtra.revision, course: newLive, publish: true });
    assert.equal(liveResponse.status, 201);
    const extraLive = await liveResponse.json();
    const newLiveCard = (await (await send("/api/academy")).json()).offers.find(({ id }) => id === extraLive.savedOfferId);
    assert.equal(newLiveCard.category, "live");
    assert.equal(newLiveCard.startsAt, "2027-01-26T19:00");
    assert.ok(!newLiveCard.liveUrl);
    const extraLiveSignup = await upload("/api/academy/order", { offerId: newLiveCard.id }, student);
    const purchasedLive = (await extraLiveSignup.json()).orders.find(({ offerId }) => offerId === newLiveCard.id);
    assert.equal(purchasedLive.category, "live");
    assert.deepEqual(purchasedLive.schedule, { date: "2027-01-26T23:00:00.000Z", zone: "America/La_Paz" });
    const extraLiveRoute = `/api/academy/orders/${purchasedLive.id}`;
    assert.equal((await send(`${extraLiveRoute}/live`, { cookie: student })).status, 403);
    assert.equal((await upload(`${extraLiveRoute}/receipt`, image, student)).status, 200);
    assert.equal((await confirm(purchasedLive.id, (await getReview(purchasedLive.id)).submissionId)).status, 200);
    const stream = await send(`${extraLiveRoute}/live`, { cookie: student });
    assert.equal(stream.status, 303);
    assert.equal(stream.headers.get("location"), liveUrl);
    assert.equal((await send(`${extraLiveRoute}/lesson`, { cookie: student })).status, 403);

    const coverUpload = await upload("/api/admin/academy/cover", image);
    assert.equal(coverUpload.status, 201);
    const cover = (await coverUpload.json()).id;
    const coverUrl = `/api/academy/covers/${cover}`;
    assert.equal((await send(coverUrl)).status, 404);
    assert.equal((await send(`/api/admin/academy/image/${cover}`, { cookie: admin })).status, 200);
    assert.equal((await send(`/api/admin/academy/image/${cover}`)).status, 401);
    const secondVideo = Buffer.concat([video.subarray(0, 20), Buffer.from("000000096d64617401", "hex")]);
    const secondVideoId = (await (await upload("/api/admin/academy/video", secondVideo)).json()).id;
    const series = { ...extra, title: "Automaquillaje", cover, chapters: [
      { title: "Preparación", text: "Preparar la piel", video: videoId },
      { title: "Acabado", text: "Sellar el maquillaje", video: secondVideoId },
    ] };
    const createPublication = (category, course, publish) => upload("/api/admin/academy/course", { category, course, publish, revision: extraLive.revision });
    assert.equal((await createPublication("special", series, true)).status, 400);
    assert.equal((await createPublication("course", { ...series, cover: "" }, true)).status, 400);
    const seriesResponse = await createPublication("course", series, false);
    assert.equal(seriesResponse.status, 201);
    const seriesDraft = await seriesResponse.json();
    assert.equal((await send(coverUrl)).status, 404);
    const seriesId = seriesDraft.savedOfferId;
    const edited = seriesDraft.offerDrafts[seriesId];
    edited.chapters.reverse();
    const seriesPublication = await update(`/api/admin/academy/course/${seriesId}`, { course: edited, publish: true, revision: seriesDraft.revision });
    assert.equal(seriesPublication.status, 200);
    const seriesCard = (await (await send("/api/academy")).json()).offers.find(({ id }) => id === seriesId);
    assert.deepEqual(seriesCard, { id: seriesId, category: "course", title: series.title, description: series.description, cents: 18050, cover, coverUrl, startsAt: "", chapterCount: 2 });
    const publishedCover = await send(coverUrl);
    assert.equal(publishedCover.headers.get("content-type"), "image/jpeg");
    assert.deepEqual(Buffer.from(await publishedCover.arrayBuffer()), image);
    const purchase = await upload("/api/academy/order", { offerId: seriesId }, student);
    const seriesOrder = (await purchase.json()).orders.find(({ offerId }) => offerId === seriesId);
    const chaptersRoute = `/api/academy/orders/${seriesOrder.id}/chapters`;
    const secondVideoRoute = `${chaptersRoute}/${edited.chapters[0].id}/video`;
    assert.equal((await send(chaptersRoute, { cookie: student })).status, 403);
    assert.equal((await send(secondVideoRoute, { cookie: student })).status, 403);
    assert.equal((await upload(`/api/academy/orders/${seriesOrder.id}/receipt`, image, student)).status, 200);
    assert.equal((await confirm(seriesOrder.id, (await getReview(seriesOrder.id)).submissionId)).status, 200);
    const unlocked = await (await send(chaptersRoute, { cookie: student })).json();
    assert.deepEqual(unlocked.chapters.map(({ videoUrl, version, ...chapter }) => chapter), edited.chapters.map(({ id, title, text }) => ({ id, title, text, hasVideo: true })));
    const signedVideo = unlocked.chapters[0].videoUrl;
    assert.ok(signedVideo.startsWith(`${secondVideoRoute}?`));
    assert.deepEqual(Buffer.from(await (await send(signedVideo, { cookie: student })).arrayBuffer()), secondVideo);
    assert.equal((await send(signedVideo)).status, 401);
    assert.equal((await send(signedVideo.replace(/expires=\d+/, "expires=1"), { cookie: student })).status, 403);
    const [firstChapter, remainingChapter] = unlocked.chapters;
    const seenRoute = `${chaptersRoute}/${firstChapter.id}/seen`;
    assert.equal((await upload(seenRoute, { version: "anterior" }, student)).status, 409);
    assert.equal((await upload(seenRoute, { version: firstChapter.version }, other)).status, 404);
    const oneChapter = (await (await upload(seenRoute, { version: firstChapter.version }, student)).json()).orders.find(({ id }) => id === seriesOrder.id);
    assert.equal(oneChapter.completed, false);
    assert.deepEqual(oneChapter.chapters.map(({ seen }) => seen), [true, false]);
    const duplicate = (await (await upload(seenRoute, { version: firstChapter.version }, student)).json()).orders.find(({ id }) => id === seriesOrder.id);
    assert.deepEqual(duplicate, oneChapter);
    const fullCourse = (await (await upload(`${chaptersRoute}/${remainingChapter.id}/seen`, { version: remainingChapter.version }, student)).json()).orders.find(({ id }) => id === seriesOrder.id);
    assert.equal(fullCourse.completed, true);
    assert.deepEqual(fullCourse.chapters.map(({ seen }) => seen), [true, true]);
    const forum = `/api/academy/orders/${seriesOrder.id}/discussion`;
    const otherPurchase = await (await upload("/api/academy/order", { offerId: seriesId }, other)).json();
    const otherSeries = otherPurchase.orders.find(({ offerId }) => offerId === seriesId);
    const otherForum = `/api/academy/orders/${otherSeries.id}/discussion`;
    assert.equal((await send(forum)).status, 401);
    assert.equal((await send(forum, { cookie: other })).status, 404);
    assert.equal((await send(otherForum, { cookie: other })).status, 403);
    assert.equal((await upload(`/api/academy/orders/${otherSeries.id}/receipt`, image, other)).status, 200);
    assert.equal((await confirm(otherSeries.id, (await getReview(otherSeries.id)).submissionId)).status, 200);
    const love = async (route, loved, token) => (await (await upload(`${route}/heart`, { loved }, token)).json()).count;
    assert.equal(await love(forum, true, student), 1);
    assert.equal(await love(forum, true, student), 1);
    assert.equal(await love(otherForum, true, other), 2);
    assert.equal(await love(forum, false, student), 1);
    const postComment = { text: "Me sirvió ver los dos capítulos.", requestId: "01010101-0101-4101-8101-010101010101" };
    const posted = await (await upload(`${forum}/comment`, postComment, student)).json();
    assert.equal(posted.pending, true);
    assert.deepEqual(posted.comments, []);
    assert.equal((await upload(`${forum}/comment`, postComment, student)).status, 200);
    const discussions = (await (await send("/api/admin/academy", { cookie: admin })).json()).courseComments;
    assert.equal(discussions.length, 1);
    const moderate = `/api/admin/academy/comments/${discussions[0].id}`;
    assert.equal((await update(moderate, { status: "approved", revision: 0 }, student)).status, 401);
    assert.equal((await update(moderate, { status: "approved", revision: 0 })).status, 200);
    const visible = await (await send(otherForum, { cookie: other })).json();
    assert.equal(visible.comments[0].text, postComment.text);
    assert.equal(visible.comments[0].name, "Estudiante");
    assert.deepEqual((await (await send(`${planRoute}/discussion`, { cookie: student })).json()).comments, []);
    assert.equal((await update(moderate, { status: "rejected", revision: 0 })).status, 409);
    assert.equal((await update(moderate, { status: "rejected", revision: 1 })).status, 200);
    assert.deepEqual((await (await send(otherForum, { cookie: other })).json()).comments, []);
    const anotherSession = sessionCookie(await upload("/api/academy/login", studentCredentials));
    assert.equal((await send(signedVideo, { cookie: anotherSession })).status, 403);

    const accountRoute = "/api/academy/account";
    const credentialsBefore = { email: studentCredentials.email, password: studentCredentials.password };
    const contact = { email: credentialsBefore.email, name: "Lucía Actualizada", whatsapp: "+591 7555-1122" };
    assert.equal((await update(accountRoute, contact, "")).status, 401);
    assert.equal((await update(accountRoute, { ...contact, whatsapp: "75551122" }, student)).status, 400);
    const contactUpdate = await update(accountRoute, contact, student);
    assert.equal(contactUpdate.status, 200);
    const savedContact = await contactUpdate.json();
    assert.equal(savedContact.student.name, contact.name);
    assert.equal(savedContact.account.whatsapp, "+59175551122");
    assert.equal((await (await send("/api/academy")).json()).account, null);
    const changedEmail = { ...contact, email: "nuevo-correo@example.test" };
    assert.equal((await update(accountRoute, changedEmail, student)).status, 400);
    assert.equal((await update(accountRoute, { ...changedEmail, currentPassword: "Contraseña equivocada" }, student)).status, 403);
    assert.equal((await update(accountRoute, { ...contact, email: "otra@example.test", currentPassword: credentialsBefore.password }, student)).status, 409);
    assert.equal((await update(subscriptionRoute, subscription, student)).status, 200);
    const emailUpdate = await update(accountRoute, { ...changedEmail, currentPassword: credentialsBefore.password }, student);
    assert.equal(emailUpdate.status, 200);
    assert.equal((await emailUpdate.json()).student.email, changedEmail.email);
    assert.equal((await send(chaptersRoute, { cookie: student })).status, 401);
    assert.equal((await send(chaptersRoute, { cookie: anotherSession })).status, 401);
    student = sessionCookie(emailUpdate);
    assert.equal((await send(chaptersRoute, { cookie: student })).status, 200);
    assert.equal((await upload("/api/academy/login", credentialsBefore)).status, 401);
    const parallelSession = sessionCookie(await upload("/api/academy/login", { ...credentialsBefore, email: changedEmail.email }));
    const newPassword = "Contraseña nueva para esta prueba";
    assert.equal((await update(`${accountRoute}/password`, { currentPassword: credentialsBefore.password, newPassword: "corta" }, student)).status, 400);
    const passwordUpdate = await update(`${accountRoute}/password`, { currentPassword: credentialsBefore.password, newPassword }, student);
    assert.equal(passwordUpdate.status, 200);
    assert.equal((await send(chaptersRoute, { cookie: parallelSession })).status, 401);
    student = sessionCookie(passwordUpdate);
    assert.equal((await send(chaptersRoute, { cookie: student })).status, 200);
    const pushAfterEdits = sentPush.length;
    assert.equal((await upload("/api/admin/academy/news", { ...news, title: "Taller tras actualizar la cuenta" })).status, 201);
    assert.equal(sentPush.length, pushAfterEdits + 1);
    assert.equal((await upload("/api/academy/login", { ...credentialsBefore, email: changedEmail.email })).status, 401);
    assert.equal((await upload("/api/academy/login", { email: changedEmail.email, password: newPassword })).status, 200);

    const settingsRoute = "/api/admin/academy/referrals";
    const settings = {
      promo: { enabled: true, code: "ARTISTA15", percent: 15 },
      invites: { enabled: true, buyerPercent: 20, referrerPercent: 12 },
    };
    assert.equal((await update(settingsRoute, settings, student)).status, 401);
    assert.equal((await update(settingsRoute, { ...settings, promo: { ...settings.promo, percent: 100 } })).status, 400);
    assert.equal((await update(settingsRoute, settings)).status, 200);
    const inviter = (await (await send("/api/academy", { cookie: secondStudent })).json()).referrals;
    assert.match(inviter.code, /^IV-[A-F0-9]{16}$/);
    assert.deepEqual(inviter.plan, { buyerPercent: 20, referrerPercent: 12 });
    const referralCodeRoute = "/api/academy/referrals/code";
    assert.equal((await send(`${referralCodeRoute}?code=hola`)).status, 401);
    assert.deepEqual(await (await send(`${referralCodeRoute}?code=brochas`, { cookie: secondStudent })).json(), { code: "BROCHAS", available: true });
    const setCode = (code, cookie = secondStudent) => update(referralCodeRoute, { code }, cookie);
    assert.equal((await setCode("artista15")).status, 409);
    assert.equal((await setCode("?especial")).status, 400);
    assert.equal((await (await setCode("brochas")).json()).referrals.code, "BROCHAS");
    assert.equal((await setCode("BROCHAS", student)).status, 409);
    assert.equal((await (await setCode("Brochas-club")).json()).referrals.code, "BROCHAS-CLUB");
    assert.equal((await setCode("BROCHAS", student)).status, 409);
    assert.equal((await update(settingsRoute, { ...settings, promo: { ...settings.promo, code: "BROCHAS" } })).status, 409);
    const invitedDetails = { ...registration, name: "Natalia Referida", email: "natalia-invitada@example.test" };
    assert.equal((await upload("/api/academy/register", { ...invitedDetails, referralCode: "IV-0000000000000000" })).status, 400);
    const invitedResponse = await upload("/api/academy/register", { ...invitedDetails, referralCode: "brochas" });
    assert.equal(invitedResponse.status, 201);
    const invited = sessionCookie(invitedResponse);
    assert.equal((await invitedResponse.json()).referrals.welcomePercent, 20);
    assert.equal((await update(settingsRoute, { ...settings, invites: { ...settings.invites, buyerPercent: 30, referrerPercent: 25 } })).status, 200);

    async function createOrder(offerId, cookie) {
      const result = await upload("/api/academy/order", { offerId }, cookie);
      assert.ok(result.ok);
      return (await result.json()).orders.find((item) => item.offerId === offerId);
    }
    const routeFor = (order, action) => `/api/academy/orders/${order.id}/${action}`;
    const abandonedOrder = await createOrder("esencial", invited);
    assert.equal(abandonedOrder.discount.kind, "invite");
    assert.equal((await upload(routeFor(abandonedOrder, "cancel"), undefined, student)).status, 404);
    const cancelled = await upload(routeFor(abandonedOrder, "cancel"), undefined, invited);
    assert.equal(cancelled.status, 200);
    assert.equal((await cancelled.json()).referrals.welcomePercent, 20);
    assert.equal((await send(routeFor(abandonedOrder, "qr"), { cookie: invited })).status, 404);
    assert.equal((await upload(routeFor(abandonedOrder, "cancel"), undefined, invited)).status, 200);
    const discountedOrder = await createOrder("esencial", invited);
    assert.notEqual(discountedOrder.id, abandonedOrder.id);
    assert.equal(discountedOrder.cents, 9560);
    assert.equal(discountedOrder.discount.kind, "invite");
    const secondInviteOrder = await createOrder("live", invited);
    assert.equal(secondInviteOrder.discount, undefined);
    assert.equal((await update(routeFor(secondInviteOrder, "discount"), { kind: "invite" }, invited)).status, 409);
    assert.equal((await update(routeFor(discountedOrder, "discount"), { kind: "promo", code: "NO-SIRVE" }, invited)).status, 400);
    const promoOrder = await update(routeFor(discountedOrder, "discount"), { kind: "promo", code: "artista15" }, invited);
    assert.equal((await promoOrder.json()).orders.find(({ id }) => id === discountedOrder.id).cents, 10158);
    assert.equal((await update(routeFor(discountedOrder, "discount"), { kind: "invite" }, invited)).status, 200);
    assert.equal((await upload(`${routeFor(discountedOrder, "receipt")}?cents=11950`, image, invited)).status, 409);
    assert.equal((await upload(`${routeFor(discountedOrder, "receipt")}?cents=9560`, image, invited)).status, 200);
    assert.equal((await upload(routeFor(discountedOrder, "cancel"), undefined, invited)).status, 409);
    assert.equal((await upload(routeFor(secondInviteOrder, "receipt"), image, invited)).status, 200);
    assert.equal((await confirm(secondInviteOrder.id, (await getReview(secondInviteOrder.id)).submissionId)).status, 409);
    assert.equal((await update(routeFor(discountedOrder, "discount"), { kind: "remove" }, invited)).status, 409);
    assert.equal((await (await send("/api/academy", { cookie: secondStudent })).json()).referrals.rewardCount, 0);
    assert.equal((await confirm(discountedOrder.id, (await getReview(discountedOrder.id)).submissionId)).status, 200);
    assert.equal((await update(routeFor(secondInviteOrder, "discount"), { kind: "invite" }, invited)).status, 409);
    assert.equal((await confirm(secondInviteOrder.id, (await getReview(secondInviteOrder.id)).submissionId)).status, 200);
    const earned = (await (await send("/api/academy", { cookie: secondStudent })).json()).referrals;
    assert.equal(earned.rewardCount, 1);
    assert.equal(earned.nextRewardPercent, 12);
    assert.ok((await inbox(secondStudent)).some(({ url }) => url === "/mi-espacio#referidos"));
    assert.ok(!(await inbox(invited)).some(({ url }) => url === "/mi-espacio#referidos"));
    const nextPurchase = await createOrder("esencial", secondStudent);
    assert.equal(nextPurchase.discount.kind, "reward");
    const extraPurchase = await createOrder("live", secondStudent);
    const rewardOrder = await update(routeFor(nextPurchase, "discount"), { kind: "reward" }, secondStudent);
    assert.equal((await rewardOrder.json()).orders.find(({ id }) => id === nextPurchase.id).cents, 10516);
    assert.equal((await update(routeFor(extraPurchase, "discount"), { kind: "reward" }, secondStudent)).status, 409);
    assert.equal((await update(routeFor(nextPurchase, "discount"), { kind: "remove" }, secondStudent)).status, 200);
    assert.equal((await update(routeFor(extraPurchase, "discount"), { kind: "reward" }, secondStudent)).status, 200);
    assert.equal((await upload(routeFor(extraPurchase, "receipt"), image, secondStudent)).status, 200);
    assert.equal((await confirm(extraPurchase.id, (await getReview(extraPurchase.id)).submissionId)).status, 200);
    assert.equal((await update(routeFor(nextPurchase, "discount"), { kind: "reward" }, secondStudent)).status, 409);
    const { participants } = await (await send("/api/academy/ranking")).json();
    assert.ok(participants.some(({ name, points }) => name === "Natalia" && points === 6));
    assert.ok(!JSON.stringify(participants).includes(invitedDetails.email));

    const financeRoute = "/api/admin/academy/finance";
    const financeReport = async (query = "period=all") => (await send(`${financeRoute}?${query}`, { cookie: admin })).json();
    assert.equal((await send(financeRoute, { cookie: student })).status, 401);
    assert.equal((await send(`${financeRoute}?period=custom&start=2026-02-30&end=2026-03-01`, { cookie: admin })).status, 400);
    const baseline = await financeReport();
    const beforeFinance = baseline.totals.find(({ currency }) => currency === "BOB");
    assert.ok(beforeFinance.discount >= discountedOrder.discount.savedCents);
    assert.equal(beforeFinance.gross - beforeFinance.discount, beforeFinance.collected);
    assert.equal(beforeFinance.net, beforeFinance.collected);
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/La_Paz", dateStyle: "short" }).format(new Date());
    const expense = new FormData();
    for (const [key, value] of Object.entries({
      requestId: randomUUID(), kind: "expense", day, currency: "USD", category: "Producción audiovisual", amount: "12,50", concept: "=fórmula de prueba",
    })) expense.set(key, value);
    expense.set("proof", new Blob([image], { type: "image/jpeg" }), "gasto.jpg");
    const expenseResponse = await upload(`${financeRoute}/entries`, expense);
    assert.equal(expenseResponse.status, 201);
    const { entry: expenseEntry } = await expenseResponse.json();
    assert.equal((await upload(`${financeRoute}/entries`, expense)).status, 200);
    assert.equal((await send(expenseEntry.proofUrl, { cookie: student })).status, 401);
    assert.equal((await send(expenseEntry.proofUrl, { cookie: admin })).status, 200);
    const refund = { requestId: randomUUID(), kind: "refund", day, currency: "BOB", amount: "20", concept: "Devolución registrada", orderId: discountedOrder.id };
    assert.equal((await upload(`${financeRoute}/entries`, { ...refund, amount: "1000" })).status, 400);
    assert.equal((await upload(`${financeRoute}/entries`, refund)).status, 201);
    const fee = { requestId: randomUUID(), kind: "fee", day, currency: "BOB", amount: "3,30", concept: "Comisión comprobada" };
    assert.equal((await upload(`${financeRoute}/entries`, fee)).status, 201);
    const report = await financeReport();
    const totalsByCurrency = Object.fromEntries(report.totals.map((total) => [total.currency, total]));
    assert.equal(totalsByCurrency.BOB.net, beforeFinance.collected - 2330);
    assert.equal(totalsByCurrency.USD.result, -1250);
    assert.ok(report.countries.some(({ country }) => country === "Bolivia"));
    assert.ok((await financeReport(`period=custom&start=${day}&end=${day}`)).entries.some(({ id }) => id === expenseEntry.id));
    const file = await send(`${financeRoute}/export?period=all`, { cookie: admin });
    assert.match(file.headers.get("content-type"), /text\/csv/);
    const csv = await file.text();
    assert.match(csv, /"'=fórmula de prueba"/);
    assert.match(csv, /"-12\.50"/);
    const voided = await send(`${financeRoute}/entries/${expenseEntry.id}`, { method: "DELETE", cookie: admin });
    assert.equal(voided.status, 200);
    const afterVoid = await financeReport();
    assert.ok(afterVoid.entries.find(({ id }) => id === expenseEntry.id).voidedAt);
    assert.ok(!afterVoid.totals.some(({ currency }) => currency === "USD"));
    {
    const waha = "/api/admin/academy/waha";
    const wahaSettings = { enabled: true, address: "https://waha.example.com", apiKey: "waha-test-key", recipient: "+591 70000000", session: "default", siteUrl: "https://ivanna.example.com", attachReceipt: true };
    assert.equal((await send(waha, { cookie: student })).status, 401);
    assert.equal((await (await send(waha, { cookie: admin })).json()).settings.attachReceipt, false);
    assert.equal((await update(waha, { ...wahaSettings, address: "https://127.0.0.1" })).status, 400);
    assert.equal((await update(waha, wahaSettings)).status, 400);
    const wahaSaved = await update(waha, { ...wahaSettings, confirmDelivery: true });
    assert.equal(wahaSaved.status, 200);
    const { settings: wahaView } = await wahaSaved.json();
    assert.equal(wahaView.apiKey, undefined);
    assert.equal(wahaView.keySaved, true);
    assert.deepEqual(await (await upload(`${waha}/test`)).json(), { connected: true, status: "Conectada" });
    assert.deepEqual(wahaRequests.map(({ path }) => path), ["/api/sessions/default"]);

    const plug = "/api/admin/academy/plugnmeet";
    const plugSettings = {
      enabled: true, serverUrl: "https://meet.example.com", clientUrl: "https://client.example.com/app/",
      apiKey: "plug-test-key", apiSecret: "plug-test-secret", room: { cloudRecording: true, autoRecording: true },
    };
    assert.equal((await send(plug, { cookie: student })).status, 401);
    const plugSaved = await update(plug, plugSettings);
    assert.equal(plugSaved.status, 200);
    const { settings: plugView } = await plugSaved.json();
    assert.equal(plugView.apiSecret, undefined);
    assert.equal(plugView.secretSaved, true);
    assert.equal((await upload(`${plug}/test`)).status, 200);
    const current = await (await send("/api/admin/academy", { cookie: admin })).json();
    const publication = await upload("/api/admin/academy/course", {
      category: "live", revision: current.revision, publish: true,
      course: { ...course, title: "Masterclass de grabación", cover: "purple", startsAt: "2026-12-31T18:00", liveProvider: "plugnmeet" },
    });
    assert.equal(publication.status, 201);
    const { savedOfferId: managedOffer } = await publication.json();
    const room = `${plug}/rooms/${managedOffer}`;
    const studentLive = await upload("/api/academy/order", { offerId: managedOffer }, secondStudent);
    assert.equal(studentLive.status, 201);
    const { orders } = await studentLive.json();
    const managed = orders.find((entry) => entry.offerId === managedOffer);
    assert.equal((await upload(routeFor(managed, "live/join"), undefined, secondStudent)).status, 403);
    assert.equal(wahaRequests.length, 1);
    assert.equal((await upload(routeFor(managed, "receipt"), image, secondStudent)).status, 200);
    async function waitForWhatsApp(orderId, status) {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const payment = await getReview(orderId);
        if (payment.whatsappStatus === status) return payment;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.fail(`No se registró el resultado de WhatsApp: ${status}`);
    }
    const review = await waitForWhatsApp(managed.id, "attached");
    assert.equal(review.status, "submitted");
    const delivered = wahaRequests.at(-1).body;
    assert.equal(delivered.chatId, "59170000000@c.us");
    assert.match(delivered.caption, /Curso: Masterclass de grabación/);
    assert.ok(delivered.caption.includes(`https://ivanna.example.com/admin/dashboard?payment=${managed.id}#academy-payments`));
    assert.deepEqual(Buffer.from(delivered.file.data, "base64"), image);
    assert.equal((await send(`/admin/dashboard?payment=${managed.id}`)).headers.get("location"), `/admin/login?payment=${managed.id}`);
    assert.equal((await confirm(managed.id, review.submissionId)).status, 200);
    assert.equal((await upload(routeFor(managed, "live/join"), undefined, secondStudent)).status, 409);
    const hosted = await upload(`${room}/host`);
    assert.equal(hosted.status, 200);
    assert.equal((await hosted.json()).url, "https://client.example.com/app/?access_token=moderator-token");
    const issued = await upload(routeFor(managed, "live/join"), undefined, secondStudent);
    assert.equal(issued.status, 200);
    assert.equal((await issued.json()).url, "https://client.example.com/app/?access_token=student-token");
    assert.ok(plugRequests.find(({ action }) => action === "room/create").input.metadata.room_features.recording_features.enable_auto_cloud_recording);
    const recordingList = await send(`${room}/recordings`, { cookie: admin });
    assert.deepEqual((await recordingList.json()).records.map(({ id }) => id), ["our-recording"]);
    assert.equal((await upload(`${room}/download`, { recordId: "another-recording" })).status, 404);
    assert.equal((await upload(`${room}/download`, { recordId: "our-recording" }, secondStudent)).status, 401);
    const downloaded = await upload(`${room}/download`, { recordId: "our-recording" });
    assert.equal((await downloaded.json()).url, "https://meet.example.com/download/recording/private-download");
    assert.equal((await upload(`${room}/end`)).status, 200);
    assert.deepEqual(await (await send(`${room}/status`, { cookie: admin })).json(), { active: false });

    attachmentAvailable = false;
    const fallbackResponse = await upload("/api/academy/order", { offerId: managedOffer }, student);
    const fallbackOrder = (await fallbackResponse.json()).orders.find(({ offerId }) => offerId === managedOffer);
    assert.equal((await upload(routeFor(fallbackOrder, "receipt"), image, student)).status, 200);
    await waitForWhatsApp(fallbackOrder.id, "link");
    assert.deepEqual(wahaRequests.slice(-2).map(({ path }) => path), ["/api/sendFile", "/api/sendText"]);
    assert.equal(wahaRequests.at(-1).body.file, undefined);
    }
  } finally {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
