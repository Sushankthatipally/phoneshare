import { Tabs } from 'expo-router';
import { tokens } from '@dropbeam/shared-ui-rn';

import { Icon, type IconName } from '../../src/components/Icon.js';

function TabIcon({ name, color }: { name: IconName; color: string }) {
  return <Icon name={name} color={color} size={20} />;
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
          tabBarIcon: ({ color }) => <TabIcon name="download" color={color} />,
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: 'Send',
          tabBarIcon: ({ color }) => <TabIcon name="send-horizontal" color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <TabIcon name="settings" color={color} />,
        }}
      />
    </Tabs>
  );
}
