import { Pressable, StyleSheet, Text, View } from 'react-native';
import { tokens } from '@dropbeam/shared-ui-rn';

export type QuickSaveValue = 'off' | 'favorites' | 'on';

const OPTIONS: ReadonlyArray<{ value: QuickSaveValue; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'favorites', label: 'Favorites' },
  { value: 'on', label: 'On' },
];

interface QuickSaveToggleProps {
  value: QuickSaveValue;
  onChange: (next: QuickSaveValue) => void;
}

export function QuickSaveToggle({ value, onChange }: QuickSaveToggleProps) {
  return (
    <View style={styles.row}>
      {OPTIONS.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={[styles.segment, active ? styles.segmentActive : null]}
          >
            <Text style={[styles.label, active ? styles.labelActive : null]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    borderRadius: tokens.radius.xl,
    borderWidth: 1,
    borderColor: tokens.color.panelBorder,
    backgroundColor: tokens.color.surface,
    padding: tokens.spacing.xs,
    gap: tokens.spacing.xs,
  },
  segment: {
    flex: 1,
    paddingVertical: tokens.spacing.sm,
    paddingHorizontal: tokens.spacing.md,
    borderRadius: tokens.radius.lg,
    alignItems: 'center',
  },
  segmentActive: {
    backgroundColor: tokens.color.text,
  },
  label: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.sm,
    fontWeight: tokens.fontWeight.semibold,
    color: tokens.color.textSoft,
    letterSpacing: tokens.letterSpacing.wide,
  },
  labelActive: {
    color: tokens.color.textInverse,
  },
});
