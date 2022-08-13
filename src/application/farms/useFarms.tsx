import create from 'zustand'

import { FarmPoolJsonInfo, HydratedFarmInfo, SdkParsedFarmInfo } from './type'
import useToken from '../token/useToken'
import useLocalStorageItem from '@/hooks/useLocalStorage'
import { HexAddress } from '@/types/constants'

export type FarmStore = {
  /** detect if hydratedInfo is ready */
  isLoading: boolean
  jsonInfos: FarmPoolJsonInfo[] // TODO: switch to Object key value pair, for faster extracting
  sdkParsedInfos: SdkParsedFarmInfo[] // TODO: switch to Object key value pair, for faster extracting
  hydratedInfos: HydratedFarmInfo[] // TODO: switch to Object key value pair, for faster extracting

  /** if exist, show detail panel */
  detailedId?: HexAddress /* FarmIds */[]
  readonly isDetailPanelShown: boolean

  /**
   * front-end customized farm id list
   * expanded collapse items
   */
  expandedItemIds: Set<string>
  haveUpcomingFarms: boolean

  // do not care it's value, just trigger React refresh
  farmRefreshCount: number
  refreshFarmInfos(): void

  onlySelfFarms: boolean
  onlySelfCreatedFarms: boolean
  currentTab: 'Raydium' | 'Fusion' | 'Ecosystem' | 'Staked'
  timeBasis: '24H' | '7D' | '30D'
  searchText: string

  stakeDialogMode: 'deposit' | 'withdraw'
  isStakeDialogOpen: boolean
  stakeDialogInfo: undefined | HydratedFarmInfo
}

const useFarms = create<FarmStore>((set, get) => ({
  isLoading: true,
  jsonInfos: [],
  sdkParsedInfos: [],
  hydratedInfos: [],

  get isDetailPanelShown() {
    //FIXME: not reactive
    const detailIdCount = get().detailedId?.length
    return Boolean(detailIdCount && detailIdCount > 0)
  },
  expandedItemIds: new Set(),
  haveUpcomingFarms: false,

  farmRefreshCount: 0,
  refreshFarmInfos: () => {
    set((s) => ({ farmRefreshCount: s.farmRefreshCount + 1 }))
    useToken.getState().refreshTokenPrice()
  },

  onlySelfFarms: false,
  onlySelfCreatedFarms: false,
  currentTab: 'Raydium',
  timeBasis: '7D',
  searchText: '',

  stakeDialogMode: 'deposit',
  isStakeDialogOpen: false,
  stakeDialogInfo: undefined
}))

export const useFarmFavoriteIds = () => useLocalStorageItem<string[]>('FAVOURITE_FARM_IDS')

export default useFarms
