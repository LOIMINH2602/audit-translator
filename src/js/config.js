// Tăng mỗi lần deploy để biết điện thoại đang chạy bản nào (hiện ở chân trang và đầu báo cáo).
export const APP_VERSION = '2026-10-10.2 tự-nhận-người-nói';

export const NAMES = {
  'en-US': 'Anh',
  'zh-CN': 'Trung',
  'ja-JP': 'Nhật',
  'ko-KR': 'Hàn',
  'vi-VN': 'Việt',
};

// Câu đọc thử cho từng tiếng (dùng ở mục Chẩn đoán để nghe chất lượng giọng TTS).
export const SAMPLES = {
  'vi-VN': 'Xin chào, tôi muốn xem hồ sơ hành động khắc phục.',
  'en-US': 'Please show me the corrective action records.',
  'zh-CN': '请让我看一下纠正措施记录。',
  'ja-JP': '是正措置の記録を見せてください。',
  'ko-KR': '시정 조치 기록을 보여 주세요.',
};

// Câu mẫu cho bài test đọc to: 3 câu mỗi tiếng, đều là câu audit ngắn. Câu tiếng Việt cố ý có "phiên"
// (dễ bị recognizer tiếng Anh nghe thành "Fren").
export const TEST_PROMPTS = {
  'vi-VN': [
    'Xin chào, tôi muốn xem hồ sơ hành động khắc phục.',
    'Phiên dịch này dùng cho buổi đánh giá nhà máy.',
    'Vui lòng cho tôi xem sổ tay chất lượng.',
  ],
  'en-US': [
    'Please show me the corrective action records.',
    'Where is the quality manual?',
    'We found one non conformity in the warehouse.',
  ],
  'zh-CN': ['请让我看一下纠正措施记录。', '质量手册在哪里？', '我们在仓库发现了一项不符合项。'],
  'ja-JP': ['是正措置の記録を見せてください。', '品質マニュアルはどこにありますか。', '倉庫で不適合が一件見つかりました。'],
  'ko-KR': ['시정 조치 기록을 보여 주세요.', '품질 매뉴얼은 어디에 있습니까?', '창고에서 부적합 사항이 하나 발견되었습니다.'],
};
