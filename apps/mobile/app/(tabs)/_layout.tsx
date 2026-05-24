import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { tokens } from '@dropbeam/shared-ui-rn';

function TabIcon({ glyph, color }: { glyph: string; color: string }) {
  return <Text style={{ color, fontSize: tokens.fontSize.bodyLg }}>{glyph}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: tokens.color.text,
        tabBarInactiveTintColor: tokens.color.textDim,
        tabBarStyle: {
          backgroundColor: tokens.color.panelBg,
          borderTopColor: tokens.color.panelBorder,
          borderTopWidth: 1,
          paddingTop: tokens.spacing.sm,
          paddingBottom: tokens.spacing.sm,
          height: 64,
        },
        tabBarLabelStyle: {
          fontFamily: tokens.fontFamily.sans,
          fontSize: tokens.fontSize.caption,
          fontWeight: tokens.fontWeight.semibold,
        },
      }}
    >
      <Tabs.Screen
        name="receive"
        options={{
          title: 'Receive',
          tabBarIcon: ({ color }) => <TabIcon glyph="↓" color={color} />,
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: 'Send',
          tabBarIcon: ({ color }) => <TabIcon glyph="↑" color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <TabIcon glyph="⚙" color={color} />,
        }}
      />
    </Tabs>
  );
}
