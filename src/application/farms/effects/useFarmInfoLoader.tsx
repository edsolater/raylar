import useLiquidity from '@/application/liquidity/useLiquidity'
import { offsetDateTime } from '@/functions/date/dateFormat'
import jFetch from '@/functions/dom/jFetch'
import { lazyMap } from '@/functions/lazyMap'
import { useEffectWithTransition } from '@/hooks/useEffectWithTransition'
import { useXStore } from '@edsolater/xstore'
import { useMemo } from 'react'
import { Endpoint } from '../../connection'
import useConnection from '../../connection/useConnection'
import { usePools } from '../../pools/usePools'
import { tokenAtom } from '../../token'
import { jsonInfo2PoolKeys } from '../../txTools/jsonInfo2PoolKeys'
import useWallet from '../../wallet/useWallet'
import { fetchFarmJsonInfos, hydrateFarmInfo, mergeSdkFarmInfo } from '../utils/handleFarmInfo'
import useFarms from '../useFarms'
import { farmAtom } from '../atom'

export default function useFarmInfoLoader() {
  const { jsonInfos, sdkParsedInfos, farmRefreshCount } = useXStore(farmAtom)
  const liquidityJsonInfos = useLiquidity((s) => s.jsonInfos)
  const pairs = usePools((s) => s.jsonInfos)
  const { tokens, getToken, getLpToken, lpTokens, tokenPrices } = useXStore(tokenAtom)
  const chainTimeOffset = useConnection((s) => s.chainTimeOffset) ?? 0
  const currentBlockChainDate = offsetDateTime(Date.now() + chainTimeOffset, { minutes: 0 /* force */ })

  const connection = useConnection((s) => s.connection)
  const currentEndPoint = useConnection((s) => s.currentEndPoint)
  const owner = useWallet((s) => s.owner)
  const lpPrices = usePools((s) => s.lpPrices)

  const aprs = useMemo(
    () => Object.fromEntries(pairs.map((i) => [i.ammId, { apr30d: i.apr30d, apr7d: i.apr7d, apr24h: i.apr24h }])),
    [pairs]
  )

  // auto fetch json farm info when init
  useEffectWithTransition(async () => {
    const farmJsonInfos = await fetchFarmJsonInfos()
    if (farmJsonInfos) useFarms.setState({ jsonInfos: farmJsonInfos })
  }, [farmRefreshCount])

  // auto fetch json farm info when init
  useEffectWithTransition(async () => {
    useFarms.setState({ haveUpcomingFarms: jsonInfos.some((info) => info.upcoming) })
  }, [jsonInfos])

  // auto sdkParse
  useEffectWithTransition(async () => {
    if (!jsonInfos || !connection) return
    if (!jsonInfos?.length) return
    const sdkParsedInfos = await mergeSdkFarmInfo(
      {
        connection,
        pools: jsonInfos.map(jsonInfo2PoolKeys),
        owner,
        config: { commitment: 'confirmed' }
      },
      { jsonInfos }
    )
    useFarms.setState({ sdkParsedInfos })
  }, [jsonInfos, connection, owner])

  // auto hydrate
  // hydrate action will depends on other state, so it will rerender many times
  useEffectWithTransition(async () => {
    const blockSlotCountForSecond = await getSlotCountForSecond(currentEndPoint)
    const hydratedInfos = await lazyMap({
      source: sdkParsedInfos,
      sourceKey: 'hydrate farm info',
      loopFn: (farmInfo) =>
        hydrateFarmInfo(farmInfo, {
          getToken,
          getLpToken,
          lpPrices,
          tokenPrices,
          liquidityJsonInfos,
          blockSlotCountForSecond,
          aprs,
          currentBlockChainDate, // same as chainTimeOffset
          chainTimeOffset // same as currentBlockChainDate
        })
    })

    useFarms.setState({ hydratedInfos, isLoading: hydratedInfos.length <= 0 })
  }, [
    aprs,
    sdkParsedInfos,
    tokens,
    lpPrices,
    tokenPrices,
    lpTokens,
    liquidityJsonInfos,
    chainTimeOffset // when connection is ready, should get connection's chain time)
  ])
}

/**
 * to calc apr use true onChain block slot count
 */
export async function getSlotCountForSecond(currentEndPoint: Endpoint | undefined): Promise<number> {
  if (!currentEndPoint) return 2
  const result = await jFetch<{
    result: {
      numSlots: number
      numTransactions: number
      samplePeriodSecs: number
      slot: number
    }[]
  }>(currentEndPoint.url, {
    method: 'post',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      id: 'getRecentPerformanceSamples',
      jsonrpc: '2.0',
      method: 'getRecentPerformanceSamples',
      params: [100]
    })
  })
  if (!result) return 2

  const performanceList = result.result
  const slotList = performanceList.map((item) => item.numSlots)
  return slotList.reduce((a, b) => a + b, 0) / slotList.length / 60
}