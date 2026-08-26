import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ComponentType,
} from "react";
import { ErrorBoundary } from "../ErrorBoundary";
import {
  Bell,
  Database,
  Info,
  Layers,
  Link2,
  ListChecks,
  Monitor,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import {
  DEFAULT_ANTHROPIC_THINKING_BUDGET,
  getEnglishI18nValue,
  translateText,
  translateWithFallback,
  LOCALES,
  submitFeedbackSubmission,
  useTaskStore,
  type AppData,
} from "@mindwtr/core";

import { useKeybindings } from "../../contexts/keybinding-context";
import { useLanguage, type Language } from "../../contexts/language-context";
import { isFlatpakRuntime, isTauriRuntime } from "../../lib/runtime";
import {
  getCalendarSourceFileName,
  isLocalCalendarFileUrl,
  localCalendarFileUrlToPath,
} from "../../lib/external-calendar-source";
import { collectFeedbackDiagnostics } from "../../lib/app-log";
import {
  markSettingsOpenTrace,
  wrapSettingsOpenImport,
} from "../../lib/settings-open-diagnostics";
import {
  buildNavKeywords,
  labelKeyOverrides,
  SETTINGS_LABEL_KEYS,
  SETTINGS_PAGE_LABEL_KEYS,
  type SettingsLabels,
} from "./settings/labels";
import { SettingsUpdateModal } from "./settings/SettingsUpdateModal";
import { SettingsSidebar } from "./settings/SettingsSidebar";
import { useAiSettings } from "./settings/useAiSettings";
import { useCalendarSettings } from "./settings/useCalendarSettings";
import { useObsidianSettings } from "./settings/useObsidianSettings";
import { useSettingsAboutPage } from "./settings/useSettingsAboutPage";
import { useSettingsAdvancedPage } from "./settings/useSettingsAdvancedPage";
import { useSettingsDataPage } from "./settings/useSettingsDataPage";
import { useSettingsMainPage } from "./settings/useSettingsMainPage";
import { useSettingsNotificationsPage } from "./settings/useSettingsNotificationsPage";
import { useSyncSettings } from "./settings/useSyncSettings";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import { usePerformanceMonitor } from "../../hooks/usePerformanceMonitor";
import { checkBudget } from "../../config/performanceBudgets";
import {
  dismissDesktopOnboardingHandoffHint,
  isDesktopOnboardingHandoffHintDismissed,
  type DesktopOnboardingHandoffPage,
} from "../../lib/desktop-onboarding-events";
import type { FeedbackSubmitInput } from "./settings/SettingsFeedbackModal";

export type SettingsPage =
  | "main"
  | "gtd"
  | "manage"
  | "notifications"
  | "sync"
  | "data"
  | "integrations"
  | "ai"
  | "advanced"
  | "about";

export type SettingsOnboardingHintPage = DesktopOnboardingHandoffPage;

const FEEDBACK_ENDPOINT_URL = String(import.meta.env.VITE_FEEDBACK_ENDPOINT_URL || '').trim();

const SettingsMainPage = lazy(
  wrapSettingsOpenImport("page-chunk:main", () =>
    import("./settings/SettingsMainPage").then((m) => ({
      default: m.SettingsMainPage,
    })),
  ),
);
const SettingsGtdPage = lazy(
  wrapSettingsOpenImport("page-chunk:gtd", () =>
    import("./settings/SettingsGtdPage").then((m) => ({
      default: m.SettingsGtdPage,
    })),
  ),
);
const SettingsManagePage = lazy(
  wrapSettingsOpenImport("page-chunk:manage", () =>
    import("./settings/SettingsManagePage").then((m) => ({
      default: m.SettingsManagePage,
    })),
  ),
);
const SettingsAiPage = lazy(
  wrapSettingsOpenImport("page-chunk:ai", () =>
    import("./settings/SettingsAiPage").then((m) => ({
      default: m.SettingsAiPage,
    })),
  ),
);
const SettingsNotificationsPage = lazy(
  wrapSettingsOpenImport("page-chunk:notifications", () =>
    import("./settings/SettingsNotificationsPage").then((m) => ({
      default: m.SettingsNotificationsPage,
    })),
  ),
);
const SettingsIntegrationsPage = lazy(
  wrapSettingsOpenImport("page-chunk:integrations", () =>
    import("./settings/SettingsIntegrationsPage").then((m) => ({
      default: m.SettingsIntegrationsPage,
    })),
  ),
);
const SettingsSyncPage = lazy(
  wrapSettingsOpenImport("page-chunk:sync", () =>
    import("./settings/SettingsSyncPage").then((m) => ({
      default: m.SettingsSyncPage,
    })),
  ),
);
const SettingsDataPage = lazy(
  wrapSettingsOpenImport("page-chunk:data", () =>
    import("./settings/SettingsDataPage").then((m) => ({
      default: m.SettingsDataPage,
    })),
  ),
);
const SettingsAdvancedPage = lazy(
  wrapSettingsOpenImport("page-chunk:advanced", () =>
    import("./settings/SettingsAdvancedPage").then((m) => ({
      default: m.SettingsAdvancedPage,
    })),
  ),
);
const SettingsAboutPage = lazy(
  wrapSettingsOpenImport("page-chunk:about", () =>
    import("./settings/SettingsAboutPage").then((m) => ({
      default: m.SettingsAboutPage,
    })),
  ),
);

// 'en' plus every locale in the LOCALES table (@mindwtr/core, from i18n/i18n-locales.ts) —
// see that module's header comment for why English isn't a table entry. `label` used to carry the
// English display name here too, but nothing reads it (SettingsMainPage's LanguageOption
// only has `native`), so it isn't reintroduced.
const LANGUAGES: { id: Language; native: string }[] = [
  { id: "en", native: "English" },
  ...Object.entries(LOCALES).map(([id, descriptor]) => ({ id: id as Language, native: descriptor.native })),
];

const maskCalendarUrl = (url: string): string => {
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (isLocalCalendarFileUrl(trimmed)) {
    const path = localCalendarFileUrlToPath(trimmed);
    const filename = getCalendarSourceFileName(trimmed);
    return filename ? `Local file /.../${filename}` : `Local file ${path}`;
  }
  const match = trimmed.match(/^(https?:\/\/)?([^/?#]+)([^?#]*)/i);
  if (!match) {
    return trimmed.length <= 8
      ? "..."
      : `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
  }
  const protocol = match[1] ?? "";
  const host = match[2] ?? "";
  const path = match[3] ?? "";
  const lastSegment = path.split("/").filter(Boolean).pop() ?? "";
  const suffix = lastSegment ? `...${lastSegment.slice(-6)}` : "...";
  return `${protocol}${host}/${suffix}`;
};

type SettingsViewProps = {
  initialPage?: SettingsPage;
  onboardingHintPage?: SettingsOnboardingHintPage;
  onResumeOnboarding?: () => void;
};

export function SettingsView({ initialPage, onboardingHintPage, onResumeOnboarding }: SettingsViewProps = {}) {
  const perf = usePerformanceMonitor("SettingsView");
  const [page, setPage] = useState<SettingsPage>(initialPage ?? "main");
  const [dismissedOnboardingHintPages, setDismissedOnboardingHintPages] = useState<
    Set<SettingsOnboardingHintPage>
  >(() => {
    const dismissed = new Set<SettingsOnboardingHintPage>();
    (["sync", "data"] as SettingsOnboardingHintPage[]).forEach((hintPage) => {
      if (isDesktopOnboardingHandoffHintDismissed(hintPage)) {
        dismissed.add(hintPage);
      }
    });
    return dismissed;
  });
  const { language, setLanguage, t: translate } = useLanguage();
  const {
    style: keybindingStyle,
    setStyle: setKeybindingStyle,
    quickAddShortcut: globalQuickAddShortcut,
    setQuickAddShortcut: setGlobalQuickAddShortcut,
    openHelp,
  } = useKeybindings();
  const settings =
    useTaskStore((state) => state.settings) ?? ({} as AppData["settings"]);
  const areas = useTaskStore((state) => state.areas);
  const updateSettings = useTaskStore((state) => state.updateSettings);
  const isTauri = isTauriRuntime();
  const isFlatpak = isFlatpakRuntime();
  const isLinux = useMemo(() => {
    if (!isTauri) return false;
    try {
      return /linux/i.test(navigator.userAgent);
    } catch {
      return false;
    }
  }, [isTauri]);
  const isMac = useMemo(() => {
    if (!isTauri) return false;
    try {
      return /mac/i.test(navigator.userAgent);
    } catch {
      return false;
    }
  }, [isTauri]);
  const autoArchiveDays = Number.isFinite(settings?.gtd?.autoArchiveDays)
    ? Math.max(0, Math.floor(settings?.gtd?.autoArchiveDays as number))
    : 7;
  const { requestConfirmation, confirmModal } = useConfirmDialog();

  const showSaved = useCallback(() => {
    // Visible settings update immediately; successful saves stay silent.
  }, []);

  useEffect(() => {
    if (!initialPage) return;
    setPage(initialPage);
  }, [initialPage]);

  const aiPageProps = useAiSettings({
    isTauri,
    settings,
    updateSettings,
    showSaved,
    enabled: true,
  });
  const selectSyncFolderTitle = useMemo(() => {
    return translateWithFallback(translate, "settings.selectSyncFolderTitle", "Select sync folder");
  }, [translate]);
  const selectObsidianVaultTitle = useMemo(() => {
    return translateWithFallback(translate, "settings.selectObsidianVaultTitle", "Select Obsidian vault");
  }, [translate]);
  const cancelLabel = useMemo(() => {
    return translateWithFallback(translate, "common.cancel", "Cancel");
  }, [translate]);

  const t = useMemo(() => {
    const result = {} as SettingsLabels;
    SETTINGS_LABEL_KEYS.forEach((key) => {
      const i18nKey = labelKeyOverrides[key] ?? `settings.${key}`;
      const englishFallback = getEnglishI18nValue(i18nKey) ?? key;
      result[key] = translateWithFallback(translate, i18nKey, englishFallback);
    });
    return result;
  }, [language, translate]);

  const advancedPageProps = useSettingsAdvancedPage({ isTauri, showSaved, t });

  const requestSettingsConfirmation = useCallback(
    ({ title, message }: { title: string; message: string }) =>
      requestConfirmation({
        title,
        description: message,
        confirmLabel: "Continue",
        cancelLabel,
      }),
    [cancelLabel, requestConfirmation],
  );
  const mainPageProps = useSettingsMainPage({
    globalQuickAddShortcut,
    isFlatpak,
    isLinux,
    isTauri,
    keybindingStyle,
    language,
    openHelp,
    setGlobalQuickAddShortcut,
    setKeybindingStyle,
    setLanguage,
    settings,
    showSaved,
    updateSettings,
  });
  const { aboutPageProps, hasUpdateBadge, logPath, updateModalProps } =
    useSettingsAboutPage({ t });
  const handleSubmitFeedback = useCallback(async (input: FeedbackSubmitInput) => {
    const diagnosticsLogs = input.includeDiagnostics && input.category === 'bug'
      ? await collectFeedbackDiagnostics()
      : null;
    await submitFeedbackSubmission(FEEDBACK_ENDPOINT_URL, {
      category: input.category,
      email: input.email,
      message: input.message,
      metadata: {
        appVersion: aboutPageProps.appVersion,
        installChannel: aboutPageProps.installChannel ?? undefined,
        locale: language,
        os: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        platform: 'desktop',
      },
      ...(diagnosticsLogs ? { diagnostics: { logs: diagnosticsLogs } } : {}),
    });
  }, [aboutPageProps.appVersion, aboutPageProps.installChannel, language]);

  useLayoutEffect(() => {
    markSettingsOpenTrace("settings-view-layout-effect", { page });
  }, [page]);

  useEffect(() => {
    markSettingsOpenTrace("settings-view-effect", { page });
    const frameId = window.requestAnimationFrame(() => {
      markSettingsOpenTrace("settings-view-first-paint", { page });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [page]);

  useEffect(() => {
    if (!perf.enabled) return;
    const timer = window.setTimeout(() => {
      checkBudget("SettingsView", perf.metrics, "settings");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [perf.enabled]);

  const anthropicThinkingOptions = [
    {
      value: DEFAULT_ANTHROPIC_THINKING_BUDGET || 1024,
      label: t.aiThinkingLow,
    },
    { value: 2048, label: t.aiThinkingMedium },
    { value: 4096, label: t.aiThinkingHigh },
  ];

  const notificationsPageProps = useSettingsNotificationsPage({
    language,
    dateFormat: mainPageProps.dateFormat,
    calendarSystem: mainPageProps.calendarSystem,
    showSaved,
  });

  const pageTitle = useMemo(() => {
    switch (page) {
      case "gtd":
        return t.gtd;
      case "manage":
        return t.manage;
      case "notifications":
        return t.notifications;
      case "ai":
        return t.ai;
      case "advanced":
        return t.advanced;
      case "sync":
        return t.sync;
      case "data":
        if (language === "zh") return "数据";
        if (language === "zh-Hant") return "數據";
        return translateText("Data", language);
      case "integrations":
        return t.integrations;
      case "about":
        return t.about;
      default:
        return t.general;
    }
  }, [language, page, t]);
  const activeOnboardingHintPage =
    onboardingHintPage === page && !dismissedOnboardingHintPages.has(onboardingHintPage)
      ? onboardingHintPage
      : undefined;
  const onboardingHintContent = useMemo(() => {
    if (activeOnboardingHintPage === "sync") {
      return {
        title: "Recommended sync path",
        body: "Dropbox is easiest for most cross-platform setups. Apple-only users can use iCloud. Use WebDAV or self-hosted if you already know you need custom storage.",
      };
    }
    if (activeOnboardingHintPage === "data") {
      return {
        title: "Import before organizing",
        body: "Pick the app you exported from, then use the Import guide for file formats and mappings. Imports add data; sync is configured separately.",
      };
    }
    return null;
  }, [activeOnboardingHintPage]);
  const dismissOnboardingHint = useCallback(() => {
    if (!activeOnboardingHintPage) return;
    dismissDesktopOnboardingHandoffHint(activeOnboardingHintPage);
    setDismissedOnboardingHintPages((current) => {
      if (current.has(activeOnboardingHintPage)) return current;
      const next = new Set(current);
      next.add(activeOnboardingHintPage);
      return next;
    });
  }, [activeOnboardingHintPage]);

  const navItems = useMemo<
    Array<{
      id: SettingsPage;
      icon: ComponentType<{ className?: string }>;
      label: string;
      description?: string;
      badge?: boolean;
      badgeLabel?: string;
    }>
  >(
    () => [
      {
        id: "main",
        icon: Monitor,
        label: t.general,
        keywords: buildNavKeywords(t, SETTINGS_PAGE_LABEL_KEYS.main, [
          "theme",
          "font size",
          "text size",
          "dark mode",
          "light mode",
          "launch at startup",
          "autostart",
          "login item",
        ]),
      },
      {
        id: "gtd",
        icon: ListChecks,
        label: t.gtd,
        keywords: buildNavKeywords(t, SETTINGS_PAGE_LABEL_KEYS.gtd, [
          "auto-archive",
          "priorities",
          "time estimates",
          "pomodoro",
          "capture",
          "inbox processing",
          "2-minute rule",
          "task editor",
        ]),
      },
      {
        id: "manage",
        icon: Layers,
        label: t.manage,
        keywords: buildNavKeywords(t, SETTINGS_PAGE_LABEL_KEYS.manage, [
          "areas",
          "contexts",
          "tags",
          "rename",
          "delete",
          "reorder",
        ]),
      },
      {
        id: "notifications",
        icon: Bell,
        label: t.notifications,
        keywords: buildNavKeywords(t, SETTINGS_PAGE_LABEL_KEYS.notifications, [
          "review reminders",
          "weekly review",
          "daily digest",
          "morning",
          "evening",
        ]),
      },
      {
        id: "sync",
        icon: RefreshCw,
        label: t.sync,
        keywords: buildNavKeywords(t, SETTINGS_PAGE_LABEL_KEYS.sync, [
          "file sync",
          "WebDAV",
          "cloud",
          "sync now",
          "sync history",
          "recovery snapshots",
          "dropbox",
          "self-hosted",
          "iCloud",
          "settings sync",
        ]),
      },
      {
        id: "data",
        icon: Database,
        label:
          language === "zh"
            ? "数据"
            : language === "zh-Hant"
              ? "數據"
              : translateText("Data", language),
        keywords: buildNavKeywords(t, SETTINGS_PAGE_LABEL_KEYS.data, [
          "backup",
          "restore",
          "import",
          "Todoist",
          "DGT GTD",
          "OmniFocus",
          "attachments",
          "cleanup",
          "diagnostics",
          "logging",
        ]),
      },
      {
        id: "integrations",
        icon: Link2,
        label: t.integrations,
        keywords: buildNavKeywords(t, SETTINGS_PAGE_LABEL_KEYS.integrations, [
          "obsidian",
          "vault",
          "calendar",
          "ICS",
          "apple calendar",
          "integration",
        ]),
      },
      {
        id: "ai",
        icon: Sparkles,
        label: t.ai,
        keywords: buildNavKeywords(t, SETTINGS_PAGE_LABEL_KEYS.ai, [
          "OpenAI",
          "Gemini",
          "Anthropic",
          "API key",
          "speech",
          "whisper",
          "copilot",
          "model",
        ]),
      },
      {
        id: "advanced",
        icon: SlidersHorizontal,
        label: t.advanced,
        keywords: buildNavKeywords(t, SETTINGS_PAGE_LABEL_KEYS.advanced, [
          "automation",
          "local api",
          "localhost",
          "port",
          "mcp",
          "Claude",
          "LLM",
        ]),
      },
      {
        id: "about",
        icon: Info,
        label: t.about,
        badge: hasUpdateBadge,
        badgeLabel: t.updateAvailable,
        keywords: buildNavKeywords(t, SETTINGS_PAGE_LABEL_KEYS.about, [
          "version",
          "update",
          "license",
          "sponsor",
        ]),
      },
    ],
    [hasUpdateBadge, language, t],
  );

  const { syncPageProps, dataTransferProps } = useSyncSettings({
    appVersion: aboutPageProps.appVersion,
    isTauri,
    showSaved,
    selectSyncFolderTitle,
    lastSyncNeverLabel: t.lastSyncNever,
    requestConfirmation: requestSettingsConfirmation,
  });
  const dataPageProps = useSettingsDataPage({
    isTauri,
    language,
    logPath,
    cancelLabel,
    showSaved,
    requestConfirmation,
    t,
    dataTransferProps,
  });
  const obsidianPageProps = useObsidianSettings({
    isTauri,
    showSaved,
    selectVaultFolderTitle: selectObsidianVaultTitle,
    messages: {
      missingMarker: t.obsidianMissingMarker,
      chooseFailed: t.obsidianChooseVaultFailed,
      saveFailed: t.obsidianSaveFailed,
      removeFailed: t.obsidianRemoveFailed,
      scanFailed: t.obsidianScanFailed,
      scanSuccess: t.obsidianScanSuccess,
    },
  });
  // Keep integrations state at SettingsView scope so the page does not remount and flicker on parent rerenders.
  const calendarPageProps = useCalendarSettings({
    showSaved,
    settings,
    updateSettings,
    supportsSystemCalendar: isMac || isLinux,
  });

  const renderPage = () => {
    if (page === "main") {
      return <SettingsMainPage t={t} languages={LANGUAGES} {...mainPageProps} />;
    }

    if (page === "gtd") {
      return (
        <SettingsGtdPage
          t={t}
          language={language}
          settings={settings}
          updateSettings={updateSettings}
          showSaved={showSaved}
          autoArchiveDays={autoArchiveDays}
          areas={areas}
          translate={translate}
        />
      );
    }

    if (page === "manage") {
      return <SettingsManagePage t={t} translate={translate} requestConfirmation={requestConfirmation} />;
    }

    if (page === "ai") {
      return (
        <SettingsAiPage
          t={t}
          anthropicThinkingOptions={anthropicThinkingOptions}
          {...aiPageProps}
        />
      );
    }

    if (page === "notifications") {
      return <SettingsNotificationsPage t={t} {...notificationsPageProps} />;
    }

    if (page === "integrations") {
      return (
        <SettingsIntegrationsPage
          t={t}
          isTauri={isTauri}
          showSaved={showSaved}
          maskCalendarUrl={maskCalendarUrl}
          {...calendarPageProps}
          {...obsidianPageProps}
        />
      );
    }

    if (page === "sync") {
      return <SettingsSyncPage t={t} {...syncPageProps} />;
    }

    if (page === "data") {
      return <SettingsDataPage t={t} {...dataPageProps} />;
    }

    if (page === "advanced") {
      return <SettingsAdvancedPage t={t} {...advancedPageProps} />;
    }

    if (page === "about") {
      return (
        <SettingsAboutPage
          t={t}
          {...aboutPageProps}
          feedbackConfigured={Boolean(FEEDBACK_ENDPOINT_URL)}
          onSubmitFeedback={handleSubmitFeedback}
        />
      );
    }

    return null;
  };

  const PageFallback = ({ currentPage }: { currentPage: SettingsPage }) => {
    useEffect(() => {
      markSettingsOpenTrace("settings-page-fallback-mounted", {
        page: currentPage,
      });
    }, [currentPage]);

    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        {translate("common.loading")}
      </div>
    );
  };

  return (
    <ErrorBoundary>
      <div className="h-full overflow-y-auto">
        <div className="h-full px-4 py-3">
          <div className="mx-auto flex h-full w-full max-w-[calc(12rem+920px+1.5rem)] flex-col gap-6 lg:flex-row">
            <SettingsSidebar
              title={t.title}
              subtitle={t.subtitle}
              searchPlaceholder={t.searchPlaceholder}
              items={navItems}
              activeId={page}
              onSelect={(id) => setPage(id as SettingsPage)}
            />

            <main className="min-w-0 flex-1 lg:max-w-[920px]">
              <div className="space-y-6">
                <header className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold tracking-tight">
                      {pageTitle}
                    </h2>
                  </div>
                </header>
                {onboardingHintContent ? (
                  <div
                    className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-foreground"
                    role="note"
                  >
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{onboardingHintContent.title}</div>
                      <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
                        {onboardingHintContent.body}
                      </div>
                    </div>
                    {onResumeOnboarding ? (
                      <button
                        type="button"
                        onClick={onResumeOnboarding}
                        className="shrink-0 rounded-md border border-primary/30 bg-background/50 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10"
                      >
                        Continue setup
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={dismissOnboardingHint}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label="Dismiss onboarding hint"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                ) : null}
                <Suspense fallback={<PageFallback currentPage={page} />}>
                  {renderPage()}
                </Suspense>
              </div>
            </main>
          </div>
        </div>

        <SettingsUpdateModal
          t={t}
          {...updateModalProps}
        />
        {confirmModal}
      </div>
    </ErrorBoundary>
  );
}
