import { Category, Entry, Kind, Topic } from './types'

type Spec = string | [title: string, kind?: Kind, min?: number]
type TopicSpec = [title: string, tagline: string, entries: Spec[]]

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const entry = (topicId: string, s: Spec): Entry => {
  const [title, kind = 'sim', min = 3] = typeof s === 'string' ? [s] : s
  return { id: `${topicId}/${slug(title)}`, title, kind, min }
}

const topic = (catId: string, [title, tagline, specs]: TopicSpec): Topic => {
  const id = `${catId}/${slug(title)}`
  return { id, title, tagline, entries: specs.map((s) => entry(id, s)) }
}

export const category = (
  id: string,
  title: string,
  icon: string,
  tagline: string,
  topics: TopicSpec[],
  group: Category['group'] = 'learn',
): Category => ({ id, title, icon: icon + '\uFE0E', tagline, group, topics: topics.map((t) => topic(id, t)) })
