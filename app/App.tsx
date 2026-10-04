import React from 'react'
import { StatusBar } from 'react-native'
import { DarkTheme, NavigationContainer } from '@react-navigation/native'
import { NativeStackScreenProps, createNativeStackNavigator } from '@react-navigation/native-stack'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { CATALOG } from './src/core/catalog'
import { CATEGORIES } from './src/curriculum'
import { BenchScreen } from './src/screens/BenchScreen'
import { CategoryScreen } from './src/screens/CategoryScreen'
import { HomeScreen } from './src/screens/HomeScreen'
import { LessonScreen } from './src/screens/LessonScreen'
import { PartsScreen } from './src/screens/PartsScreen'
import { PartViewer } from './src/screens/PartViewer'
import { TopicScreen } from './src/screens/TopicScreen'
import { C } from './src/ui/theme'

type Routes = {
  Home: undefined
  Category: { id: string }
  Topic: { categoryId: string; id: string }
  Lesson: { entryId: string }
  Bench: undefined
  Parts: undefined
  Part: { name: string }
}
type P<K extends keyof Routes> = NativeStackScreenProps<Routes, K>

const Stack = createNativeStackNavigator<Routes>()

const findCategory = (id: string) => CATEGORIES.find((c) => c.id === id)!
const findTopic = (categoryId: string, id: string) => findCategory(categoryId).topics.find((t) => t.id === id)!
const findLesson = (entryId: string) =>
  CATEGORIES.flatMap((c) => c.topics.flatMap((t) => t.entries)).find((e) => e.id === entryId)!.lesson!

const THEME = { ...DarkTheme, colors: { ...DarkTheme.colors, background: C.bg, card: C.bg, text: C.text, primary: C.accent } }

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <NavigationContainer theme={THEME}>
        <Stack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: C.bg },
            headerTintColor: C.accent,
            headerTitleStyle: { color: C.text, fontWeight: '600' },
            headerShadowVisible: false,
            headerBackButtonDisplayMode: 'minimal',
            contentStyle: { backgroundColor: C.bg },
            orientation: 'portrait_up',
          }}>
          <Stack.Screen name="Home" component={Home} options={{ headerShown: false }} />
          <Stack.Screen name="Category" component={Category} options={({ route }) => ({ title: findCategory(route.params.id).title })} />
          <Stack.Screen name="Topic" component={TopicRoute} options={({ route }) => ({ title: findTopic(route.params.categoryId, route.params.id).title })} />
          <Stack.Screen name="Lesson" component={Lesson} options={{ headerShown: false }} />
          <Stack.Screen name="Bench" component={Bench} options={{ headerShown: false }} />
          <Stack.Screen name="Parts" component={Parts} options={{ title: 'Parts' }} />
          <Stack.Screen name="Part" component={Part} options={{ headerShown: false }} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  )
}

function Home({ navigation }: P<'Home'>) {
  return (
    <HomeScreen
      onCategory={(c) => navigation.navigate('Category', { id: c.id })}
      onTopic={(c, t) => navigation.navigate('Topic', { categoryId: c.id, id: t.id })}
      onBench={() => navigation.navigate('Bench')}
      onParts={() => navigation.navigate('Parts')}
    />
  )
}

function Category({ navigation, route }: P<'Category'>) {
  const category = findCategory(route.params.id)
  return <CategoryScreen category={category} onTopic={(t) => navigation.navigate('Topic', { categoryId: category.id, id: t.id })} />
}

function TopicRoute({ navigation, route }: P<'Topic'>) {
  const topic = findTopic(route.params.categoryId, route.params.id)
  return (
    <TopicScreen
      topic={topic}
      onLesson={(l) => navigation.navigate('Lesson', { entryId: topic.entries.find((e) => e.lesson === l)!.id })}
    />
  )
}

function Lesson({ navigation, route }: P<'Lesson'>) {
  return <LessonScreen lesson={findLesson(route.params.entryId)} onBack={navigation.goBack} />
}

function Bench({ navigation }: P<'Bench'>) {
  return <BenchScreen onBack={navigation.goBack} />
}

function Parts({ navigation }: P<'Parts'>) {
  return <PartsScreen onOpen={(e) => navigation.navigate('Part', { name: e.name })} />
}

function Part({ navigation, route }: P<'Part'>) {
  return <PartViewer part={CATALOG.find((e) => e.name === route.params.name)!} onBack={navigation.goBack} />
}
