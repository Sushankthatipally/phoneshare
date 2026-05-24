import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { GlassPanel, SectionHeading, tokens } from '@dropbeam/shared-ui-rn';

import { Pressable, ScrollView, Text, TextInput, View } from '../lib/native.js';
import { QuickSaveToggle } from '../components/QuickSaveToggle.js';
import { useConnection } from '../lib/connection.js';
import { useMobileIdentity } from '../lib/identity.js';

export function SettingsScreen() {
  const { deviceFingerprint } = useConnection();
  const identity = useMobileIdentity(deviceFingerprint);
  const [nameDraft, setNameDraft] = useState('');

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <SectionHeading eyebrow="Identity" title="This device" />
      <GlassPanel style={styles.panel}>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>Friendly name</Text>
            <Text style={styles.fieldValue}>{identity.friendlyName}</Text>
          </View>
          <Pressable
            onPress={identity.regenerateName}
            style={styles.ghostButton}
          >
            <Text style={styles.ghostButtonText}>Regenerate</Text>
          </Pressable>
        </View>
        <View style={styles.editRow}>
          <TextInput
            value={nameDraft}
            onChangeText={setNameDraft}
            placeholder="Type a custom name"
            style={styles.input}
          />
          <Pressable
            onPress={async () => {
              if (!nameDraft.trim()) return;
              await identity.setFriendlyName(nameDraft);
              setNameDraft('');
            }}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>Save</Text>
          </Pressable>
        </View>
        <View style={styles.divider} />
        <View>
          <Text style={styles.fieldLabel}>Hashtag</Text>
          <Text style={styles.fieldValue}>{identity.hashtag}</Text>
          <Text style={styles.fieldHint}>Derived from your device fingerprint. Read-only.</Text>
        </View>
      </GlassPanel>

      <SectionHeading eyebrow="Quick Save" title="Auto-accept policy" />
      <GlassPanel style={styles.panel}>
        <QuickSaveToggle value={identity.quickSave} onChange={identity.setQuickSave} />
        <Text style={styles.fieldHint}>
          Off — manual accept every transfer. Favorites — auto-accept hearted devices only. On — always auto-accept.
        </Text>
      </GlassPanel>

      <SectionHeading eyebrow="Favorites" title="Hearted devices" />
      <GlassPanel style={styles.panel}>
        {identity.favorites.length === 0 ? (
          <Text style={styles.fieldHint}>Heart a device on the Send tab to add it here.</Text>
        ) : (
          <View style={styles.favoritesList}>
            {identity.favorites.map((fp) => (
              <View key={fp} style={styles.favoriteRow}>
                <Text style={styles.favoriteFp} numberOfLines={1}>{fp}</Text>
                <Pressable onPress={() => identity.toggleFavorite(fp)} style={styles.ghostButton}>
                  <Text style={styles.ghostButtonText}>Remove</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </GlassPanel>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: tokens.color.bg,
  },
  scrollContent: {
    padding: tokens.spacing.lg,
    gap: tokens.spacing.lg,
  },
  panel: {
    padding: tokens.spacing.lg,
    gap: tokens.spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.spacing.md,
  },
  editRow: {
    flexDirection: 'row',
    gap: tokens.spacing.sm,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: tokens.color.panelBorder,
    borderRadius: tokens.radius.lg,
    backgroundColor: tokens.color.inputBg,
    color: tokens.color.text,
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.base,
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.sm,
  },
  fieldLabel: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.xs,
    fontWeight: tokens.fontWeight.semibold,
    color: tokens.color.textSoft,
    letterSpacing: tokens.letterSpacing.widest,
    textTransform: 'uppercase',
    marginBottom: tokens.spacing.xs,
  },
  fieldValue: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.bodyLg,
    fontWeight: tokens.fontWeight.semibold,
    color: tokens.color.text,
  },
  fieldHint: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.sm,
    color: tokens.color.textSoft,
    lineHeight: tokens.fontSize.sm * tokens.lineHeight.body,
  },
  ghostButton: {
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.sm,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.color.panelBorder,
  },
  ghostButtonText: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.sm,
    fontWeight: tokens.fontWeight.semibold,
    color: tokens.color.textSoft,
  },
  primaryButton: {
    paddingHorizontal: tokens.spacing.lg,
    paddingVertical: tokens.spacing.sm,
    backgroundColor: tokens.color.text,
    borderRadius: tokens.radius.lg,
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.sm,
    fontWeight: tokens.fontWeight.semibold,
    color: tokens.color.textInverse,
  },
  divider: {
    height: 1,
    backgroundColor: tokens.color.panelBorder,
  },
  favoritesList: {
    gap: tokens.spacing.sm,
  },
  favoriteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.spacing.md,
  },
  favoriteFp: {
    flex: 1,
    fontFamily: tokens.fontFamily.mono,
    fontSize: tokens.fontSize.caption,
    color: tokens.color.textSoft,
  },
});
