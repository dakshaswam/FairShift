// Interface text for the FairShift assistant, in the app's four languages.
// The assistant itself can reply in any language (see set_language on the server).

export type AssistantMode = "ask" | "stub" | "pay" | "rights" | "claim" | "offer"

const en = {
  placeholder: "Ask about your pay, hours or rights",
  send: "Send",
  stop: "Stop",
  listen: "Listen",
  stopListen: "Stop audio",
  copy: "Copy",
  copied: "Copied",
  photo: "Add pay stub photo",
  mic: "Speak",
  clear: "New chat",
  disclaimer:
    "General information, not legal advice. Rules can differ by state and city. Free U.S. Labor Dept. helpline:",
  welcomeH: "Let’s check that you were paid fairly.",
  welcomeP:
    "Ask in your language. You can also add a photo of your pay stub and every line will be explained.",
  starters: [
    "Explain my pay stub",
    "Did I get paid the right overtime?",
    "I work for tips. Is my pay legal?",
    "Who can help me near me?",
  ],
  thinking: "Thinking",
  errGeneric: "That message didn’t go through. Send it again.",
  retry: "Try again",
  errRate: "Too many requests. Wait a moment and try again.",
  errNotConfigured:
    "The assistant isn’t set up yet. Ask the app team to add the AI key.",
  errRefusal:
    "I can’t help with that one. Try asking another way, or call the free helpline below.",
  photoTip:
    "Cover your Social Security and bank account numbers before taking the photo.",
  estimateTitle: "Estimated underpayment",
  colWeek: "Week",
  colHours: "Hours",
  colOwed: "Should be paid",
  colPaid: "You were paid",
  colDiff: "Difference",
  total: "Total owed",
  estNote: "Estimate using federal rules. Your state may require more.",
  ok: "No underpayment found",
  helpTitle: "Help near you",
  jobsTitle: "Jobs near you",
  categories: {
    legal_aid: "Free legal aid",
    worker_center: "Worker centers",
    consulate: "Your consulate",
  },
  fast: "Fast",
  careful: "Careful",
  speedLabel: "Answer speed",
  modes: {
    ask: "Ask anything",
    stub: "Pay stub",
    pay: "Check my pay",
    rights: "My rights",
    claim: "Build a claim",
    offer: "Job offer",
  },
  hints: {
    ask: "Ask about pay, hours, rights or jobs.",
    stub: "Add a photo of your pay stub. I’ll explain every line and point out what to check.",
    pay: "Tell me your hours and pay. I’ll work out if you were underpaid.",
    rights:
      "Learn your wage rights in simple words, including what to do if you’re afraid to speak up.",
    claim:
      "I’ll ask a few questions and write a summary you can bring to the Labor Department or a worker center.",
    offer:
      "Tell me about a job offer. I’ll look for warning signs and questions to ask.",
  },
  voice: {
    listening: "Listening… speak now. Tap the microphone to stop.",
    unsupported:
      "Voice typing isn’t supported in this browser. Try Chrome or Safari, or use the microphone on your keyboard.",
    blocked:
      "The microphone is blocked. Allow microphone access in your browser, or use the microphone on your keyboard.",
    nospeech: "I didn’t hear anything. Tap the microphone and try again.",
  },
}

export type AssistantStrings = typeof en

const es: AssistantStrings = {
  placeholder: "Pregunta sobre tu pago, tus horas o tus derechos",
  send: "Enviar",
  stop: "Detener",
  listen: "Escuchar",
  stopListen: "Detener audio",
  copy: "Copiar",
  copied: "Copiado",
  photo: "Agregar foto del talón de pago",
  mic: "Hablar",
  clear: "Nuevo chat",
  disclaimer:
    "Información general, no es asesoría legal. Las reglas cambian según el estado y la ciudad. Línea gratuita del Departamento del Trabajo:",
  welcomeH: "Revisemos si te pagaron lo justo.",
  welcomeP:
    "Pregunta en tu idioma. También puedes agregar una foto de tu talón de pago y se te explicará cada línea.",
  starters: [
    "Explícame mi talón de pago",
    "¿Me pagaron bien las horas extra?",
    "Trabajo con propinas. ¿Mi pago es legal?",
    "¿Quién me puede ayudar cerca de mí?",
  ],
  thinking: "Pensando",
  errGeneric: "El mensaje no se envió. Envíalo de nuevo.",
  retry: "Intentar de nuevo",
  errRate: "Demasiadas solicitudes. Espera un momento e inténtalo otra vez.",
  errNotConfigured:
    "El asistente aún no está configurado. Pide al equipo de la app que agregue la clave de IA.",
  errRefusal:
    "No puedo ayudar con eso. Intenta preguntarlo de otra forma o llama a la línea gratuita de abajo.",
  photoTip:
    "Tapa tu número de Seguro Social y de cuenta bancaria antes de tomar la foto.",
  estimateTitle: "Pago faltante estimado",
  colWeek: "Semana",
  colHours: "Horas",
  colOwed: "Debió pagarse",
  colPaid: "Te pagaron",
  colDiff: "Diferencia",
  total: "Total que te deben",
  estNote: "Cálculo estimado con reglas federales. Tu estado puede exigir más.",
  ok: "No se encontró pago faltante",
  helpTitle: "Ayuda cerca de ti",
  jobsTitle: "Trabajos cerca de ti",
  categories: {
    legal_aid: "Ayuda legal gratuita",
    worker_center: "Centros de trabajadores",
    consulate: "Tu consulado",
  },
  fast: "Rápido",
  careful: "Cuidadoso",
  speedLabel: "Velocidad de respuesta",
  modes: {
    ask: "Pregunta lo que quieras",
    stub: "Talón de pago",
    pay: "Revisar mi pago",
    rights: "Mis derechos",
    claim: "Preparar un reclamo",
    offer: "Oferta de trabajo",
  },
  hints: {
    ask: "Pregunta sobre pago, horas, derechos o trabajos.",
    stub: "Agrega una foto de tu talón de pago. Te explico cada línea y qué revisar.",
    pay: "Dime tus horas y tu pago. Calculo si te pagaron de menos.",
    rights:
      "Conoce tus derechos de pago en palabras sencillas, incluso qué hacer si tienes miedo de hablar.",
    claim:
      "Te hago unas preguntas y escribo un resumen para llevar al Departamento del Trabajo o a un centro de trabajadores.",
    offer:
      "Cuéntame de una oferta de trabajo. Busco señales de alerta y preguntas que debes hacer.",
  },
  voice: {
    listening: "Escuchando… habla ahora. Toca el micrófono para detener.",
    unsupported:
      "Este navegador no permite escribir con la voz. Prueba Chrome o Safari, o usa el micrófono de tu teclado.",
    blocked:
      "El micrófono está bloqueado. Permite el acceso al micrófono en tu navegador, o usa el micrófono de tu teclado.",
    nospeech: "No escuché nada. Toca el micrófono e inténtalo otra vez.",
  },
}

const hi: AssistantStrings = {
  placeholder: "अपनी तनख्वाह, घंटों या अधिकारों के बारे में पूछें",
  send: "भेजें",
  stop: "रोकें",
  listen: "सुनें",
  stopListen: "ऑडियो रोकें",
  copy: "कॉपी",
  copied: "कॉपी हो गया",
  photo: "पे स्टब की फोटो जोड़ें",
  mic: "बोलें",
  clear: "नई चैट",
  disclaimer:
    "यह सामान्य जानकारी है, कानूनी सलाह नहीं। नियम राज्य और शहर के अनुसार अलग हो सकते हैं। श्रम विभाग की मुफ़्त हेल्पलाइन:",
  welcomeH: "आइए देखें कि आपको सही वेतन मिला या नहीं।",
  welcomeP:
    "अपनी भाषा में पूछें। आप अपने पे स्टब की फोटो भी जोड़ सकते हैं, हर लाइन आसान भाषा में समझाई जाएगी।",
  starters: [
    "मेरा पे स्टब समझाइए",
    "क्या मुझे ओवरटाइम सही मिला?",
    "मेरी कमाई टिप पर निर्भर है। क्या मेरा वेतन कानूनी है?",
    "मेरे पास कौन मदद कर सकता है?",
  ],
  thinking: "प्रतीक्षा करें",
  errGeneric: "संदेश नहीं गया। कृपया फिर से भेजें।",
  retry: "फिर कोशिश करें",
  errRate: "बहुत अधिक अनुरोध। थोड़ी देर रुककर फिर कोशिश करें।",
  errNotConfigured: "सहायक अभी सेट नहीं है। ऐप टीम से AI कुंजी जोड़ने को कहें।",
  errRefusal:
    "मैं इसमें मदद नहीं कर सकता। दूसरे तरीके से पूछें, या नीचे दी गई मुफ़्त हेल्पलाइन पर कॉल करें।",
  photoTip: "फोटो लेने से पहले सोशल सिक्योरिटी और बैंक खाता नंबर ढक दें।",
  estimateTitle: "अनुमानित कम भुगतान",
  colWeek: "सप्ताह",
  colHours: "घंटे",
  colOwed: "मिलना चाहिए था",
  colPaid: "आपको मिला",
  colDiff: "अंतर",
  total: "कुल बकाया",
  estNote:
    "यह संघीय नियमों पर आधारित अनुमान है। आपका राज्य ज़्यादा माँग सकता है।",
  ok: "कोई कम भुगतान नहीं मिला",
  helpTitle: "आपके पास मदद",
  jobsTitle: "आपके पास नौकरियाँ",
  categories: {
    legal_aid: "मुफ़्त कानूनी सहायता",
    worker_center: "वर्कर सेंटर",
    consulate: "आपका वाणिज्य दूतावास",
  },
  fast: "तेज़",
  careful: "विस्तार से",
  speedLabel: "जवाब की गति",
  modes: {
    ask: "कुछ भी पूछें",
    stub: "पे स्टब",
    pay: "मेरा वेतन जाँचें",
    rights: "मेरे अधिकार",
    claim: "दावा तैयार करें",
    offer: "नौकरी का प्रस्ताव",
  },
  hints: {
    ask: "वेतन, घंटे, अधिकार या नौकरी के बारे में पूछें।",
    stub: "अपने पे स्टब की फोटो जोड़ें। हर लाइन समझाई जाएगी और जाँचने लायक बातें बताई जाएँगी।",
    pay: "अपने घंटे और वेतन बताएँ। देखा जाएगा कि कम भुगतान हुआ या नहीं।",
    rights: "अपने वेतन के अधिकार आसान शब्दों में जानें, और डर लगे तो क्या करें।",
    claim:
      "कुछ सवाल पूछे जाएँगे और एक सारांश लिखा जाएगा जो श्रम विभाग या वर्कर सेंटर को दिया जा सके।",
    offer:
      "किसी नौकरी के प्रस्ताव के बारे में बताएँ। चेतावनी के संकेत और पूछने लायक सवाल बताए जाएँगे।",
  },
  voice: {
    listening: "सुना जा रहा है… अब बोलिए। रोकने के लिए माइक्रोफ़ोन दबाएँ।",
    unsupported:
      "यह ब्राउज़र आवाज़ से टाइप करने का समर्थन नहीं करता। Chrome या Safari आज़माएँ, या अपने कीबोर्ड का माइक्रोफ़ोन इस्तेमाल करें।",
    blocked:
      "माइक्रोफ़ोन बंद है। अपने ब्राउज़र में माइक्रोफ़ोन की अनुमति दें, या कीबोर्ड का माइक्रोफ़ोन इस्तेमाल करें।",
    nospeech: "कुछ सुनाई नहीं दिया। माइक्रोफ़ोन दबाकर फिर कोशिश करें।",
  },
}

const vi: AssistantStrings = {
  placeholder: "Hỏi về lương, giờ làm hoặc quyền của bạn",
  send: "Gửi",
  stop: "Dừng",
  listen: "Nghe",
  stopListen: "Dừng âm thanh",
  copy: "Sao chép",
  copied: "Đã sao chép",
  photo: "Thêm ảnh phiếu lương",
  mic: "Nói",
  clear: "Trò chuyện mới",
  disclaimer:
    "Thông tin chung, không phải tư vấn pháp lý. Quy định có thể khác nhau theo tiểu bang và thành phố. Đường dây miễn phí của Bộ Lao động:",
  welcomeH: "Hãy kiểm tra xem bạn có được trả lương đúng không.",
  welcomeP:
    "Hỏi bằng ngôn ngữ của bạn. Bạn cũng có thể thêm ảnh phiếu lương và từng dòng sẽ được giải thích.",
  starters: [
    "Giải thích phiếu lương của tôi",
    "Tôi có được trả tiền làm thêm giờ đúng không?",
    "Tôi làm việc nhờ tiền boa. Lương của tôi có hợp pháp không?",
    "Ai có thể giúp tôi ở gần đây?",
  ],
  thinking: "Đang suy nghĩ",
  errGeneric: "Tin nhắn chưa được gửi. Hãy gửi lại.",
  retry: "Thử lại",
  errRate: "Quá nhiều yêu cầu. Hãy chờ một lát rồi thử lại.",
  errNotConfigured: "Trợ lý chưa được thiết lập. Hãy nhờ nhóm phát triển thêm khóa AI.",
  errRefusal:
    "Tôi không thể giúp việc này. Hãy thử hỏi cách khác, hoặc gọi đường dây miễn phí bên dưới.",
  photoTip: "Che số An sinh Xã hội và số tài khoản ngân hàng trước khi chụp ảnh.",
  estimateTitle: "Số tiền trả thiếu ước tính",
  colWeek: "Tuần",
  colHours: "Giờ",
  colOwed: "Lẽ ra phải trả",
  colPaid: "Bạn đã nhận",
  colDiff: "Chênh lệch",
  total: "Tổng số tiền còn thiếu",
  estNote:
    "Ước tính theo quy định liên bang. Tiểu bang của bạn có thể yêu cầu nhiều hơn.",
  ok: "Không phát hiện trả thiếu",
  helpTitle: "Trợ giúp gần bạn",
  jobsTitle: "Việc làm gần bạn",
  categories: {
    legal_aid: "Trợ giúp pháp lý miễn phí",
    worker_center: "Trung tâm lao động",
    consulate: "Lãnh sự quán của bạn",
  },
  fast: "Nhanh",
  careful: "Kỹ lưỡng",
  speedLabel: "Tốc độ trả lời",
  modes: {
    ask: "Hỏi bất cứ điều gì",
    stub: "Phiếu lương",
    pay: "Kiểm tra lương",
    rights: "Quyền của tôi",
    claim: "Lập đơn khiếu nại",
    offer: "Lời mời làm việc",
  },
  hints: {
    ask: "Hỏi về lương, giờ làm, quyền lợi hoặc việc làm.",
    stub: "Thêm ảnh phiếu lương. Tôi sẽ giải thích từng dòng và chỉ ra điều cần kiểm tra.",
    pay: "Cho tôi biết giờ làm và tiền lương. Tôi sẽ tính xem bạn có bị trả thiếu không.",
    rights:
      "Tìm hiểu quyền về tiền lương bằng lời đơn giản, kể cả khi bạn sợ lên tiếng.",
    claim:
      "Tôi sẽ hỏi vài câu và viết bản tóm tắt để bạn mang đến Bộ Lao động hoặc trung tâm lao động.",
    offer:
      "Kể cho tôi về lời mời làm việc. Tôi sẽ tìm dấu hiệu cảnh báo và câu hỏi nên hỏi.",
  },
  voice: {
    listening: "Đang nghe… hãy nói. Chạm vào micrô để dừng.",
    unsupported:
      "Trình duyệt này không hỗ trợ nhập bằng giọng nói. Hãy thử Chrome hoặc Safari, hoặc dùng micrô trên bàn phím.",
    blocked:
      "Micrô đang bị chặn. Hãy cho phép truy cập micrô trong trình duyệt, hoặc dùng micrô trên bàn phím.",
    nospeech: "Tôi không nghe thấy gì. Chạm vào micrô và thử lại.",
  },
}

const byLanguage: Record<string, AssistantStrings> = {
  English: en,
  Español: es,
  हिन्दी: hi,
  "Tiếng Việt": vi,
}

export const assistantStrings = (language: string) => byLanguage[language] ?? en
