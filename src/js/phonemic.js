// Mở micro ĐIỆN THOẠI sao cho tai nghe Bluetooth vẫn ở chế độ nghe nhạc (A2DP) suốt buổi nghe.
// Vì sao (11/10/2026, Lợi Minh test Hội trường qua FreeArc: ngắt quãng liên tục, không song song): nhận diện của Chrome
// mở/tắt micro mỗi câu → Android chuyển tai nghe sang chế độ cuộc gọi rồi chuyển lại, giọng đọc bị cắt.
// Mã nguồn Chromium (media/audio/android/audio_manager_android.cc):
//  - Luồng micro có xử lý âm thanh (khử vọng / lọc ồn / tự chỉnh âm lượng) → SetCommunicationAudioModeOn(true) =
//    MODE_IN_COMMUNICATION (chế độ cuộc gọi). Tắt hết xử lý (NO_EFFECTS) → không đổi chế độ.
//  - MakeLowLatencyInputStream → SetCommunicationDevice(device_id): micro mặc định để máy tự chọn (có thể chọn tai nghe
//    Bluetooth → bật kênh gọi SCO). Chọn đích danh micro điện thoại thì không dùng SCO.
// Tên thiết bị Chrome Android đặt: "Speakerphone", "Headset earpiece", "Bluetooth headset", "Wired headset", "USB audio".

const BAD = /bluetooth|usb|wired|có dây|tai nghe bluetooth/i;
const PREFER = [/earpiece/i, /speaker|loa/i, /built-?in|internal|tích hợp|bên trong|điện thoại|phone/i];

// devices: kết quả enumerateDevices(). Trả về deviceId micro điện thoại nên dùng, hoặc '' (không tìm được → micro mặc định).
export function chooseMic(devices) {
  const ins = devices.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
  const ok = ins.filter((d) => d.label && !BAD.test(d.label));
  for (const re of PREFER) {
    const d = ok.find((x) => re.test(x.label));
    if (d) return d.deviceId;
  }
  return ok.length ? ok[0].deviceId : '';
}

export const NO_EFFECTS = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 };

// pref: deviceId đã chọn tay, '' = tự chọn. Trả về { stream, label, deviceId, auto }.
export async function openPhoneMic(pref = '') {
  const md = navigator.mediaDevices;
  let list = await md.enumerateDevices();
  // chưa có quyền micro thì tên thiết bị rỗng: xin quyền bằng micro mặc định (đóng ngay), rồi liệt kê lại
  if (!list.some((d) => d.kind === 'audioinput' && d.label)) {
    const s = await md.getUserMedia({ audio: NO_EFFECTS });
    s.getTracks().forEach((t) => t.stop());
    list = await md.enumerateDevices();
  }
  const id = pref && list.some((d) => d.deviceId === pref) ? pref : chooseMic(list);
  const audio = id ? { ...NO_EFFECTS, deviceId: { exact: id } } : NO_EFFECTS;
  const stream = await md.getUserMedia({ audio });
  const track = stream.getAudioTracks()[0];
  return { stream, label: (track && track.label) || '(mặc định)', deviceId: id, auto: !pref, devices: list.filter((d) => d.kind === 'audioinput') };
}
