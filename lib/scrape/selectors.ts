// ⚠️ 이 파일의 값은 살아 있는 네이버 스마트에디터 ONE에서 실제로 클릭까지 확인한 실측값이다
// (7장 함정 목록). 추론으로 다시 만들 수 없다. 그대로 쓴다.
//
// 네이버 DOM이 바뀌어 셀렉터가 깨지면 이 파일 하나만 고치면 되도록, 셀렉터를 코드
// 여기저기에 흩뿌리지 않고 전부 여기 모아둔다.
//
// 각 항목은 "후보 배열"이다. 위에서부터 isVisible 인 첫 번째를 쓰는 헬퍼(firstVisible)와
// 함께 쓴다. 환경(계정·시점·A/B)에 따라 다른 값이 맞을 수 있어, 9장 6.5-b 실측으로 새
// 값을 찾으면 배열 "앞에 추가"하고 기존 값은 지우지 않는다.

export const EDITOR = {
  frame: "iframe#mainFrame",

  // ⚠️ 7-3: 복원 팝업이 뜰 때 반투명 차단막이 함께 깔린다. 남아 있으면 발행 버튼 클릭이
  // 조용히 무시된다(에러도 안 난다).
  restorePopup: [".se-popup-container", ".se-popup-dialog", ".se-popup", "[class*='popup_container']"],

  // ⚠️ 7-1 최악의 함정: button:has-text('취소') 는 '취소선' 버튼에도 부분일치해서
  // 글 전체에 취소선이 켜진 채로 타이핑된다. 클래스 기반을 먼저 쓰고, 텍스트를 쓸 땐
  // 팝업 안으로 스코프 + :text-is('취소') 정확일치를 쓴다 (':text-is'는 '취소선'에 매칭 안 됨).
  restoreCancel: [
    "button.se-popup-button-cancel",
    ".se-popup-button-cancel",
    ".se-popup-container button:text-is('취소')",
  ],

  title: [
    ".se-section-documentTitle .se-text-paragraph",
    ".se-documentTitle .se-text-paragraph",
    ".se-title-text",
  ],
  body: [".se-section-text .se-text-paragraph", ".se-component-content .se-text-paragraph", ".se-main-container"],

  imageButton: [
    "button.se-image-toolbar-button",
    "button[data-name='image']",
    "button[data-log='sti.image']",
    "button.se-toolbar-item-image",
  ],

  helpPanel: [".se-help-container", ".se-help-panel"],
  helpClose: [".se-help-panel-close-button", ".se-help-header button"],
  popupDim: [".se-popup-dim"],

  textFormatOpen: [".se-text-format-toolbar-button"],
  optHeading: [".se-toolbar-option-text-format-sectionTitle-button"],
  optBody: [".se-toolbar-option-text-format-text-button"],
  optQuote: [".se-toolbar-option-text-format-quotation-button"],
  dividerInsert: [".se-insert-horizontal-line-default-toolbar-button"],
  bold: [".se-bold-toolbar-button"],
  bgColorOpen: [".se-background-color-toolbar-button"],
  bgColorYellow: ["button[title='#fff8b2']", ".se-color-palette[title='#fff8b2']"],
  bgColorNone: [".se-color-palette-no-color"],
  contentComponents: [".se-content .se-component"],

  publishOpen: ["button[data-click-area='tpb.publish']", "button.publish_btn__m9KHH"],
  // ⚠️ 7-2: :has-text('발행') 은 '예약 발행 0건' 을 누른다(부분일치). data-click-area
  // 값에 '*' 이 들어간 것이 맞다.
  publishConfirm: ["button[data-click-area='tpb*i.publish']", "button.confirm_btn__WEaBq"],

  // ⚠️ 7-19: radio input 은 opacity:0 이라 클릭되지 않는다. label 을 눌러야 한다.
  // 네이버 기본값은 전체공개(open_public, value=2)다.
  visibility: {
    public: { label: 'label[for="open_public"]', input: "#open_public" },
    neighbor: { label: 'label[for="open_neighbor"]', input: "#open_neighbor" },
    both: { label: 'label[for="open_both_neighbor"]', input: "#open_both_neighbor" },
    private: { label: 'label[for="open_private"]', input: "#open_private" },
  },

  caption: [".se-caption"], // 펼쳐지면 se-is-on 이 붙는다 (7-18)
  imageComponent: [".se-content .se-component.se-image"],

  // ⚠️ 7-21: 우측 도크(라이브러리) 클래스는 환경에 따라 다르다. 두 계열 모두 시도한다.
  sidebarClose: [".se-help-panel-close-button", ".se-sidebar-close-button"],
  sidebar: [".se-sidebar", ".se-sidebar-container-library"],

  // ⚠️ 7-6: 하단 글감 검색바. 탈출 클릭 좌표를 잘못 잡으면 여기로 타이핑이 샌다.
  bottomToolbar: [".se-flayer-unified-toolbar-wrapper"],
  bottomSearchInput: [".se-flayer-unified-search-input"],
} as const;

export type VisibilityKey = keyof typeof EDITOR.visibility;
