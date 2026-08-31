import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { Check, Clock3, RefreshCw } from 'lucide-react-native';
import {
  getTaskScheduledAt,
  isTaskAttentionEligible,
  normalizeAttentionFrames,
  safeFormatDate,
  selectNow,
  shallow,
  type ExternalCalendarEvent,
  type Task,
  useTaskStore,
} from '@mindwtr/core';

import { useLanguage } from '../../../contexts/language-context';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { fetchExternalCalendarEvents } from '@/lib/external-calendar';

const reasonKey = {
  'calendar-event': 'attention.now.meeting',
  scheduled: 'attention.now.scheduled',
  frame: 'attention.now.frame',
  focused: 'attention.now.focused',
  'next-action': 'attention.now.next',
} as const;

const compareCommitments = (left: Task, right: Task) => (
  (left.focusOrder ?? Number.MAX_SAFE_INTEGER) - (right.focusOrder ?? Number.MAX_SAFE_INTEGER)
  || left.createdAt.localeCompare(right.createdAt)
);

export default function NowScreen() {
  const router = useRouter();
  const tc = useThemeColors();
  const { t } = useLanguage();
  const { tasks, settings, updateTask } = useTaskStore((state) => ({
    tasks: state.tasks,
    settings: state.settings,
    updateTask: state.updateTask,
  }), shallow);
  const [now, setNow] = useState(() => new Date());
  const [externalEvents, setExternalEvents] = useState<ExternalCalendarEvent[]>([]);
  const [excludedTaskIds, setExcludedTaskIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(interval);
  }, []);

  useFocusEffect(useCallback(() => {
    setNow(new Date());
    setExcludedTaskIds(new Set());
    const controller = typeof AbortController === 'undefined' ? null : new AbortController();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    void fetchExternalCalendarEvents(start, end, {
      signal: controller?.signal,
      timeoutMs: 12_000,
    }).then(({ events }) => setExternalEvents(events)).catch((error: unknown) => {
      if (!(error instanceof Error && error.name === 'AbortError')) setExternalEvents([]);
    });
    return () => controller?.abort();
  }, []));

  const attentionFrames = useMemo(
    () => normalizeAttentionFrames(settings.gtd?.attentionFrames),
    [settings.gtd?.attentionFrames],
  );
  const selection = useMemo(() => selectNow({
    events: externalEvents,
    excludedTaskIds,
    frames: attentionFrames,
    now,
    tasks,
    timeEstimatesEnabled: settings.features?.timeEstimates !== false,
  }), [attentionFrames, excludedTaskIds, externalEvents, now, settings.features?.timeEstimates, tasks]);
  const commitments = useMemo(() => tasks
    .filter((task) => !task.deletedAt && task.isFocusedToday && isTaskAttentionEligible(task, now))
    .sort(compareCommitments), [now, tasks]);
  const inboxCount = tasks.filter((task) => !task.deletedAt && task.status === 'inbox').length;

  const currentTask = selection?.kind === 'task' ? selection.task : null;
  const currentEvent = selection?.kind === 'event' ? selection.event : null;
  const schedule = currentTask ? getTaskScheduledAt(currentTask) : undefined;

  const completeCurrentTask = () => {
    if (!currentTask) return;
    void updateTask(currentTask.id, { status: 'done', isFocusedToday: false });
  };
  const snoozeCurrentTask = () => {
    if (!currentTask) return;
    const snoozedUntil = new Date(now.getTime() + 30 * 60_000).toISOString();
    void updateTask(currentTask.id, { snoozedUntil });
  };
  const showAnother = () => {
    if (!currentTask) return;
    setExcludedTaskIds((current) => new Set([...current, currentTask.id]));
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: tc.bg }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.intro}>
        <Text style={[styles.eyebrow, { color: tc.tint }]}>{t('attention.now.title')}</Text>
        <Text style={[styles.clock, { color: tc.secondaryText }]}>{safeFormatDate(now, 'p')}</Text>
      </View>

      <View style={[styles.current, { backgroundColor: tc.cardBg, borderColor: tc.border }]}>
        {selection ? (
          <>
            <Text style={[styles.reason, { color: tc.secondaryText }]}>
              {t(reasonKey[selection.reason])}
            </Text>
            <Text style={[styles.title, { color: tc.text }]}>
              {currentTask?.title || currentEvent?.title || t('calendar.eventFallbackTitle')}
            </Text>
            {currentEvent ? (
              <Text style={[styles.meta, { color: tc.secondaryText }]}>
                {safeFormatDate(currentEvent.start, 'p')}–{safeFormatDate(currentEvent.end, 'p')}
                {currentEvent.location ? ` · ${currentEvent.location}` : ''}
              </Text>
            ) : null}
            {currentTask && schedule ? (
              <Text style={[styles.meta, { color: tc.secondaryText }]}>
                {safeFormatDate(schedule, 'p')}
              </Text>
            ) : null}
            {currentTask ? (
              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  onPress={completeCurrentTask}
                  style={({ pressed }) => [styles.primaryButton, { backgroundColor: tc.tint, opacity: pressed ? 0.82 : 1 }]}
                >
                  <Check color={tc.onTint} size={18} />
                  <Text style={[styles.primaryButtonText, { color: tc.onTint }]}>{t('common.done')}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={snoozeCurrentTask}
                  style={({ pressed }) => [styles.secondaryButton, { borderColor: tc.border, opacity: pressed ? 0.7 : 1 }]}
                >
                  <Clock3 color={tc.secondaryText} size={17} />
                  <Text style={[styles.secondaryButtonText, { color: tc.text }]}>{t('attention.now.snooze')}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('attention.now.another')}
                  onPress={showAnother}
                  style={styles.iconButton}
                >
                  <RefreshCw color={tc.secondaryText} size={18} />
                </Pressable>
              </View>
            ) : null}
          </>
        ) : (
          <>
            <Text style={[styles.title, { color: tc.text }]}>{t('attention.now.clear')}</Text>
            <Text style={[styles.emptyBody, { color: tc.secondaryText }]}>{t('attention.now.clearBody')}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/plan')}
              style={({ pressed }) => [styles.secondaryButton, styles.planButton, { borderColor: tc.border, opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={[styles.secondaryButtonText, { color: tc.text }]}>{t('nav.plan')}</Text>
            </Pressable>
          </>
        )}
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: tc.text }]}>{t('agenda.todaysFocus')}</Text>
        {commitments.length > 0 ? commitments.map((task) => (
          <View key={task.id} style={[styles.commitmentRow, { borderBottomColor: tc.border }]}>
            <View style={[styles.dot, { backgroundColor: task.id === currentTask?.id ? tc.tint : tc.border }]} />
            <Text style={[styles.commitmentTitle, { color: tc.text }]} numberOfLines={2}>{task.title}</Text>
          </View>
        )) : (
          <Text style={[styles.emptyBody, { color: tc.secondaryText }]}>{t('todayPlan.noCommitments')}</Text>
        )}
      </View>

      <Text style={[styles.inboxNote, { color: tc.secondaryText }]}>
        {inboxCount > 0
          ? `${inboxCount} ${t('attention.now.inboxWaiting')}`
          : t('attention.now.inboxEmpty')}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 28, paddingBottom: 120, gap: 28 },
  intro: { alignItems: 'center', gap: 4 },
  eyebrow: { fontSize: 13, fontWeight: '800', letterSpacing: 1.8 },
  clock: { fontSize: 13, fontVariant: ['tabular-nums'] },
  current: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, paddingHorizontal: 20, paddingVertical: 24 },
  reason: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3, marginBottom: 10 },
  title: { fontSize: 27, lineHeight: 34, fontWeight: '700' },
  meta: { fontSize: 14, lineHeight: 20, marginTop: 10, fontVariant: ['tabular-nums'] },
  emptyBody: { fontSize: 14, lineHeight: 21, marginTop: 8 },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 22 },
  primaryButton: { minHeight: 46, borderRadius: 12, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 8 },
  primaryButtonText: { fontSize: 15, fontWeight: '700' },
  secondaryButton: { minHeight: 46, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  secondaryButtonText: { fontSize: 14, fontWeight: '600' },
  iconButton: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center' },
  planButton: { alignSelf: 'flex-start', marginTop: 18 },
  section: { gap: 4 },
  sectionTitle: { fontSize: 17, fontWeight: '700', marginBottom: 6 },
  commitmentRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  commitmentTitle: { flex: 1, fontSize: 15, lineHeight: 21 },
  inboxNote: { fontSize: 12, lineHeight: 18, textAlign: 'center' },
});
