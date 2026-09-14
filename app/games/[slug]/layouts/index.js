import PubgLayout from './Pubg'
import FreeFireLayout from './FreeFire'
import CodmLayout from './Codm'
import MaleoLayout from './Maleo'
import EfootballLayout from './Efootball'
import DlsLayout from './Dls'
import UflLayout from './Ufl'
import Cpm2Layout from './Cpm2'
import DefaultLayout from './Default'

// Each game gets its own genuinely different page layout/component.
// Anything not listed here (e.g. a new game added later) falls back
// to DefaultLayout automatically.
export const LAYOUTS = {
  pubg: PubgLayout,
  freefire: FreeFireLayout,
  codm: CodmLayout,
  maleo_bussid: MaleoLayout,
  efootball: EfootballLayout,
  dls: DlsLayout,
  ufl: UflLayout,
  cpm2: Cpm2Layout,
}

export { DefaultLayout }
