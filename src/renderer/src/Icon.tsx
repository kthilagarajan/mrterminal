import { icons, type IconName } from './icons'

export function Icon({ name }: { name: IconName }) {
  return <span className="icon" dangerouslySetInnerHTML={{ __html: icons[name] }} />
}
