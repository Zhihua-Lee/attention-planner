import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CalendarDays, ChevronRight, Folder, Hourglass, Repeat2, Star } from 'lucide-react-native';
import {
  formatI18nTemplate,
  getTaskScheduledAt,
  isTaskAttentionEligible,
  safeFormatDate,
  safeParseDate,
  shallow,
  taskMatchesAreaFilter,
  type Task,
  useTaskStore,
} from '@mindwtr/core';

import { TaskEditModal } from '@/components/task-edit-modal';
import { useMobileAreaFilter } from '@/hooks/use-mobile-area-filter';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { useLanguage } from '../../../contexts/language-context';

const READY_PREVIEW_LIMIT = 12;

const isSameLocalDay = (value: string | undefined, day: Date): boolean => {
  const date = safeParseDate(value);
  return Boolean(date
    && date.getFullYear() === day.getFullYear()
    && date.getMonth() === day.getMonth()
    && date.getDate() === day.getDate());
};

const taskSort = (left: Task, right: Task) => (
  (left.focusOrder ?? Number.MAX_SAFE_INTEGER) - (right.focusOrder ?? Number.MAX_SAFE_INTEGER)
  || left.createdAt.localeCompare(right.createdAt)
);

export default function PlanScreen() {
  const router = useRouter();
  const tc = useThemeColors();
  const { t } = useLanguage();
  const { areaById, resolvedAreaFilter } = useMobileAreaFilter();
  const { projects, tasks, updateTask } = useTaskStore((state) => ({
    projects: state.projects,
    tasks: state.tasks,
    updateTask: state.updateTask,
  }), shallow);
  const [showAllReady, setShowAllReady] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);

  const visibleTasks = useMemo(() => tasks.filter((task) => (
    !task.deletedAt && taskMatchesAreaFilter(task, resolvedAreaFilter, projectById, areaById)
  )), [areaById, projectById, resolvedAreaFilter, tasks]);
  const eligible = useMemo(() => visibleTasks
    .filter((task) => isTaskAttentionEligible(task, now))
    .sort(taskSort), [now, visibleTasks]);
  const commitments = eligible.filter((task) => task.isFocusedToday);
  const timeBlocks = eligible
    .filter((task) => isSameLocalDay(getTaskScheduledAt(task), now))
    .sort((left, right) => (
      (safeParseDate(getTaskScheduledAt(left))?.getTime() ?? Number.MAX_SAFE_INTEGER)
      - (safeParseDate(getTaskScheduledAt(right))?.getTime() ?? Number.MAX_SAFE_INTEGER)
    ));
  const commitmentIds = new Set(commitments.map((task) => task.id));
  const timeBlockIds = new Set(timeBlocks.map((task) => task.id));
  const ready = eligible.filter((task) => !commitmentIds.has(task.id) && !timeBlockIds.has(task.id));
  const shownReady = showAllReady ? ready : ready.slice(0, READY_PREVIEW_LIMIT);
  const recurring = visibleTasks.filter((task) => task.recurrence && task.status !== 'done' && task.status !== 'archived');
  const waitingCount = visibleTasks.filter((task) => task.status === 'waiting').length;
  const somedayCount = visibleTasks.filter((task) => task.status === 'someday').length;

  const renderTask = (task: Task, options: { showTime?: boolean; showStar?: boolean } = {}) => (
    <Pressable
      key={task.id}
      accessibilityRole="button"
      onPress={() => setEditingTask(task)}
      style={({ pressed }) => [styles.taskRow, { borderBottomColor: tc.border, opacity: pressed ? 0.7 : 1 }]}
    >
      {options.showTime ? (
        <Text style={[styles.time, { color: tc.secondaryText }]}>
          {safeFormatDate(getTaskScheduledAt(task), 'p')}
        </Text>
      ) : null}
      <Text style={[styles.taskTitle, { color: tc.text }]} numberOfLines={2}>{task.title}</Text>
      {options.showStar ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={task.isFocusedToday ? t('agenda.removeFromFocus') : t('agenda.addToFocus')}
          hitSlop={8}
          onPress={(event) => {
            event.stopPropagation();
            void updateTask(task.id, { isFocusedToday: !task.isFocusedToday });
          }}
          style={styles.starButton}
        >
          <Star color={task.isFocusedToday ? tc.tint : tc.secondaryText} fill={task.isFocusedToday ? tc.tint : 'transparent'} size={19} />
        </Pressable>
      ) : null}
    </Pressable>
  );

  return (
    <>
      <ScrollView
        style={[styles.container, { backgroundColor: tc.bg }]}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View>
          <Text style={[styles.title, { color: tc.text }]}>{t('plan.title')}</Text>
          <Text style={[styles.subtitle, { color: tc.secondaryText }]}>{t('plan.subtitle')}</Text>
        </View>

        <View style={styles.shortcuts}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/calendar')}
            style={({ pressed }) => [styles.shortcut, { borderColor: tc.border, backgroundColor: tc.cardBg, opacity: pressed ? 0.72 : 1 }]}
          >
            <CalendarDays color={tc.tint} size={21} />
            <Text style={[styles.shortcutLabel, { color: tc.text }]}>{t('nav.calendar')}</Text>
            <ChevronRight color={tc.secondaryText} size={18} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/projects-screen')}
            style={({ pressed }) => [styles.shortcut, { borderColor: tc.border, backgroundColor: tc.cardBg, opacity: pressed ? 0.72 : 1 }]}
          >
            <Folder color={tc.tint} size={21} />
            <Text style={[styles.shortcutLabel, { color: tc.text }]}>{t('nav.projects')}</Text>
            <ChevronRight color={tc.secondaryText} size={18} />
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: tc.text }]}>{t('agenda.todaysFocus')}</Text>
          <Text style={[styles.hint, { color: tc.secondaryText }]}>{t('todayPlan.commitmentsHint')}</Text>
          {commitments.length > 0
            ? commitments.map((task) => renderTask(task, { showStar: true }))
            : <Text style={[styles.empty, { color: tc.secondaryText }]}>{t('todayPlan.noCommitments')}</Text>}
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: tc.text }]}>{t('todayPlan.timeBlocks')}</Text>
          <Text style={[styles.hint, { color: tc.secondaryText }]}>{t('todayPlan.timeBlocksHint')}</Text>
          {timeBlocks.length > 0
            ? timeBlocks.map((task) => renderTask(task, { showTime: true }))
            : <Text style={[styles.empty, { color: tc.secondaryText }]}>{t('todayPlan.noTimeBlocks')}</Text>}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeadingRow}>
            <Text style={[styles.sectionTitle, { color: tc.text }]}>{t('nav.next')}</Text>
            <Text style={[styles.count, { color: tc.secondaryText }]}>
              {formatI18nTemplate(t('todayPlan.readyCount'), { shown: shownReady.length, count: ready.length })}
            </Text>
          </View>
          <Text style={[styles.hint, { color: tc.secondaryText }]}>{t('todayPlan.readyHint')}</Text>
          {shownReady.length > 0
            ? shownReady.map((task) => renderTask(task, { showStar: true }))
            : <Text style={[styles.empty, { color: tc.secondaryText }]}>{t('todayPlan.noReady')}</Text>}
          {ready.length > READY_PREVIEW_LIMIT ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setShowAllReady((value) => !value)}
              style={styles.textButton}
            >
              <Text style={[styles.textButtonLabel, { color: tc.tint }]}>
                {showAllReady
                  ? t('todayPlan.showFewerReady')
                  : formatI18nTemplate(t('todayPlan.viewAllReady'), { count: ready.length })}
              </Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeadingRow}>
            <View style={styles.sectionIconTitle}>
              <Hourglass color={tc.secondaryText} size={18} />
              <Text style={[styles.sectionTitle, { color: tc.text }]}>{t('plan.later')}</Text>
            </View>
            <Text style={[styles.count, { color: tc.secondaryText }]}>{waitingCount + somedayCount}</Text>
          </View>
          <View style={styles.laterActions}>
            <Pressable accessibilityRole="button" onPress={() => router.push('/waiting')} style={[styles.pill, { borderColor: tc.border }]}>
              <Text style={[styles.pillText, { color: tc.text }]}>{t('nav.waiting')} · {waitingCount}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => router.push('/someday')} style={[styles.pill, { borderColor: tc.border }]}>
              <Text style={[styles.pillText, { color: tc.text }]}>{t('nav.someday')} · {somedayCount}</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionIconTitle}>
            <Repeat2 color={tc.secondaryText} size={18} />
            <Text style={[styles.sectionTitle, { color: tc.text }]}>{t('plan.recurring')}</Text>
          </View>
          {recurring.length > 0
            ? recurring.map((task) => renderTask(task))
            : <Text style={[styles.empty, { color: tc.secondaryText }]}>{t('plan.recurringEmpty')}</Text>}
        </View>
      </ScrollView>

      <TaskEditModal
        visible={Boolean(editingTask)}
        task={editingTask}
        onClose={() => setEditingTask(null)}
        onSave={(taskId, updates) => updateTask(taskId, updates)}
        defaultTab="task"
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 22, paddingBottom: 130, gap: 28 },
  title: { fontSize: 25, lineHeight: 31, fontWeight: '700' },
  subtitle: { fontSize: 14, lineHeight: 21, marginTop: 5, maxWidth: 520 },
  shortcuts: { flexDirection: 'row', gap: 10 },
  shortcut: { flex: 1, minHeight: 50, borderWidth: 1, borderRadius: 13, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 9 },
  shortcutLabel: { flex: 1, fontSize: 14, fontWeight: '600' },
  section: { gap: 2 },
  sectionHeadingRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  sectionIconTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: 17, lineHeight: 23, fontWeight: '700' },
  hint: { fontSize: 12, lineHeight: 18, marginBottom: 5 },
  count: { fontSize: 12, fontVariant: ['tabular-nums'] },
  empty: { fontSize: 14, lineHeight: 20, paddingVertical: 12 },
  taskRow: { minHeight: 50, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  time: { width: 70, fontSize: 12, fontVariant: ['tabular-nums'] },
  taskTitle: { flex: 1, fontSize: 15, lineHeight: 21 },
  starButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  textButton: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  textButtonLabel: { fontSize: 14, fontWeight: '600' },
  laterActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 8 },
  pill: { minHeight: 44, borderWidth: 1, borderRadius: 22, paddingHorizontal: 14, justifyContent: 'center' },
  pillText: { fontSize: 13, fontWeight: '600' },
});
