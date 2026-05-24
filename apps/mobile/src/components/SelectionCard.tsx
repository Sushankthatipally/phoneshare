import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GlassPanel, tokens } from '@dropbeam/shared-ui-rn';

interface SelectionCardProps {
  icon: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}

export function SelectionCard({ icon, label, onPress, disabled }: SelectionCardProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [{ flex: 1, opacity: disabled ? tokens.opacity.disabled : pressed ? 0.78 : 1 }]}
    >
      <GlassPanel style={styles.card}>
        <View style={styles.iconWrap}>
          <Text style={styles.icon}>{icon}</Text>
        </View>
        <Text style={styles.label}>{label}</Text>
      </GlassPanel>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingVertical: tokens.spacing.lg,
    paddingHorizontal: tokens.spacing.md,
    alignItems: 'center',
    gap: tokens.spacing.sm,
    minHeight: 92,
  },
  iconWrap: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: tokens.fontSize.xl,
    color: tokens.color.text,
  },
  label: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.sm,
    color: tokens.color.text,
    fontWeight: tokens.fontWeight.medium,
    textAlign: 'center',
  },
});
