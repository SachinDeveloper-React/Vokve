import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { duration as durations, spacing, useTheme } from '../../theme';
import { AppText } from '../ui/AppText';
import { Icon } from '../media/Icon';

interface ItemProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
}

/**
 * One expandable row.
 *
 * The panel's natural height is measured once through `onLayout` on an
 * absolutely positioned copy, then animated to. Animating to a height of
 * `auto` is not possible, and hard-coding one breaks the moment the content
 * changes length.
 */
export const AccordionItem = memo(
  ({ title, subtitle, children, expanded, onToggle }: ItemProps) => {
    const { colors } = useTheme();
    const [contentHeight, setContentHeight] = useState(0);
    const progress = useSharedValue(expanded ? 1 : 0);

    useEffect(() => {
      progress.value = withTiming(expanded ? 1 : 0, {
        duration: durations.normal,
      });
    }, [expanded, progress]);

    const onMeasure = useCallback((event: LayoutChangeEvent) => {
      setContentHeight(event.nativeEvent.layout.height);
    }, []);

    const panelStyle = useAnimatedStyle(() => ({
      height: progress.value * contentHeight,
      opacity: progress.value,
    }));

    const chevronStyle = useAnimatedStyle(() => ({
      transform: [{ rotate: `${progress.value * 180}deg` }],
    }));

    return (
      <View style={[styles.item, { borderBottomColor: colors.border }]}>
        <Pressable
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={title}
          style={styles.header}
        >
          <View style={styles.headerText}>
            <AppText variant="bodyStrong">{title}</AppText>
            {subtitle ? (
              <AppText variant="caption" color="textSecondary">
                {subtitle}
              </AppText>
            ) : null}
          </View>
          <Animated.View style={chevronStyle}>
            <Icon as={ChevronDown} size="md" color="textTertiary" />
          </Animated.View>
        </Pressable>

        <Animated.View style={[styles.panel, panelStyle]}>
          <View style={styles.panelInner}>{children}</View>
        </Animated.View>

        {/* Off-screen measuring copy — never visible, never touchable. */}
        <View style={styles.measure} pointerEvents="none" onLayout={onMeasure}>
          <View style={styles.panelInner}>{children}</View>
        </View>
      </View>
    );
  },
);

AccordionItem.displayName = 'AccordionItem';

interface AccordionProps {
  children: React.ReactNode;
  /** When true, opening one row closes the others. */
  exclusive?: boolean;
  initialOpenIndex?: number;
}

interface AccordionSection {
  title: string;
  subtitle?: string;
  content: React.ReactNode;
}

interface ListProps extends Omit<AccordionProps, 'children'> {
  sections: AccordionSection[];
}

/**
 * Renders a list of expandable sections. `exclusive` keeps at most one open,
 * which is the right default for a settings or FAQ list.
 */
export const Accordion = memo(
  ({ sections, exclusive = true, initialOpenIndex }: ListProps) => {
    const [open, setOpen] = useState<number[]>(
      initialOpenIndex === undefined ? [] : [initialOpenIndex],
    );

    const toggle = useCallback(
      (index: number) => {
        setOpen(current => {
          const isOpen = current.includes(index);
          if (exclusive) {
            return isOpen ? [] : [index];
          }
          return isOpen
            ? current.filter(i => i !== index)
            : [...current, index];
        });
      },
      [exclusive],
    );

    const openSet = useMemo(() => new Set(open), [open]);

    return (
      <View>
        {sections.map((section, index) => (
          <AccordionItem
            key={section.title}
            title={section.title}
            subtitle={section.subtitle}
            expanded={openSet.has(index)}
            onToggle={() => toggle(index)}
          >
            {section.content}
          </AccordionItem>
        ))}
      </View>
    );
  },
);

Accordion.displayName = 'Accordion';

const styles = StyleSheet.create({
  item: { borderBottomWidth: StyleSheet.hairlineWidth },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.base,
    minHeight: 56,
  },
  headerText: { flex: 1, gap: spacing.xxs },
  panel: { overflow: 'hidden' },
  panelInner: { paddingBottom: spacing.base },
  measure: {
    position: 'absolute',
    opacity: 0,
    left: 0,
    right: 0,
    zIndex: -1,
  },
});
