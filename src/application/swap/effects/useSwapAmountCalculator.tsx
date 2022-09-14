import { useXStore } from '@/../../xstore/dist'
import { liquidityAtom } from '@/application/liquidity/atom'
import { shakeUndifindedItem } from '@/functions/arrayMethods'
import toPubString from '@/functions/format/toMintString'
import { toPercent } from '@/functions/format/toPercent'
import { toTokenAmount } from '@/functions/format/toTokenAmount'
import { isMintEqual } from '@/functions/judgers/areEqual'
import { eq } from '@/functions/numberish/compare'
import { toString } from '@/functions/numberish/toString'
import useAsyncEffect from '@/hooks/useAsyncEffect'
import { HexAddress, Numberish } from '@/types/constants'
import { jsonInfo2PoolKeys, Liquidity, Trade, WSOL } from '@raydium-io/raydium-sdk'
import { useRouter } from 'next/router'
import { useEffect } from 'react'
import useAppSettings from '../../appSettings/useAppSettings'
import { Connection } from '../../connection'
import useConnection from '../../connection/useConnection'
import { SDKParsedLiquidityInfo } from '../../liquidity/type'
import { sdkParseJsonLiquidityInfo } from '../../liquidity/utils/sdkParseJsonLiquidityInfo'
import { deUIToken, deUITokenAmount, toUITokenAmount } from '../../token'
import { SplToken } from '../../token/type'
import useWallet from '../../wallet/useWallet'
import { swapAtom } from '../atom'

export function useSwapAmountCalculator() {
  const { pathname } = useRouter()

  const connection = useConnection((s) => s.connection)
  const { coin1 } = useXStore(swapAtom)
  const { coin2 } = useXStore(swapAtom)
  const { coin1Amount: userCoin1Amount } = useXStore(swapAtom)
  const { coin2Amount: userCoin2Amount } = useXStore(swapAtom)
  const { refreshCount } = useXStore(swapAtom)
  const { directionReversed } = useXStore(swapAtom)
  const focusSide = directionReversed ? 'coin2' : 'coin1' // temporary focus side is always up, due to swap route's `Trade.getBestAmountIn()` is not ready
  const slippageTolerance = useAppSettings((s) => s.slippageTolerance)
  const connected = useWallet((s) => s.connected)

  /** for swap is always from up to down, up/down is easier to calc */
  const upCoin = directionReversed ? coin2 : coin1
  const upCoinAmount = (directionReversed ? userCoin2Amount : userCoin1Amount) || '0'
  const downCoin = directionReversed ? coin1 : coin2
  const downCoinAmount = (directionReversed ? userCoin1Amount : userCoin2Amount) || '0'

  const { jsonInfos } = useXStore(liquidityAtom)
  useEffect(() => {
    cleanCalcCache()
  }, [refreshCount])

  // if don't check focusSideCoin, it will calc twice.
  // one for coin1Amount then it will change coin2Amount
  // changing coin2Amount will cause another calc
  useAsyncEffect(async () => {
    // pairInfo is not enough
    if (!upCoin || !downCoin || !connection || !pathname.startsWith('/swap')) {
      swapAtom.set({
        fee: undefined,
        minReceived: undefined,
        maxSpent: undefined,
        routes: undefined,
        priceImpact: undefined,
        executionPrice: undefined,
        ...{ [focusSide === 'coin1' ? 'coin2Amount' : 'coin1Amount']: undefined }
      })
      return
    }

    const focusDirectionSide = 'up' // temporary focus side is always up, due to swap route's `Trade.getBestAmountIn()` is not ready
    // focusSide === 'coin1' ? (directionReversed ? 'down' : 'up') : directionReversed ? 'up' : 'down'

    // SOL / WSOL is special
    const inputIsSolWSOL = isMintEqual(coin1, coin2) && isMintEqual(coin1, WSOL.mint)
    if (inputIsSolWSOL) {
      if (eq(userCoin1Amount, userCoin2Amount)) return
      swapAtom.set({
        fee: undefined,
        minReceived: undefined,
        maxSpent: undefined,
        routes: undefined,
        priceImpact: undefined,
        executionPrice: undefined,
        ...{
          [focusSide === 'coin1' ? 'coin2Amount' : 'coin1Amount']:
            focusSide === 'coin1' ? toString(userCoin1Amount) : toString(userCoin2Amount)
        }
      })
      return
    }

    try {
      const calcResult = await calculatePairTokenAmount({
        upCoin,
        upCoinAmount,
        downCoin,
        downCoinAmount,
        connection,
        focusSide: focusDirectionSide,
        slippageTolerance
      })
      // for calculatePairTokenAmount is async, result maybe droped. if that, just stop it
      const resultStillFresh = (() => {
        const directionReversed = swapAtom.get().directionReversed
        const currentUpCoinAmount = (directionReversed ? swapAtom.get().coin2Amount : swapAtom.get().coin1Amount) || '0'
        const currentDownCoinAmount =
          (directionReversed ? swapAtom.get().coin1Amount : swapAtom.get().coin2Amount) || '0'
        const currentFocusSideAmount = focusDirectionSide === 'up' ? currentUpCoinAmount : currentDownCoinAmount
        const focusSideAmount = focusDirectionSide === 'up' ? upCoinAmount : downCoinAmount
        return eq(currentFocusSideAmount, focusSideAmount)
      })()
      if (!resultStillFresh) return

      if (focusDirectionSide === 'up') {
        const { routes, priceImpact, executionPrice, currentPrice, swapable, routeType, fee } = calcResult ?? {}
        const { amountOut, minAmountOut } = (calcResult?.info ?? {}) as { amountOut?: string; minAmountOut?: string }
        swapAtom.set({
          fee,
          routes,
          priceImpact,
          executionPrice,
          currentPrice,
          minReceived: minAmountOut,
          maxSpent: undefined,
          swapable,
          routeType,
          ...{ [focusSide === 'coin1' ? 'coin2Amount' : 'coin1Amount']: amountOut }
        })
      } else {
        const { routes, priceImpact, executionPrice, currentPrice, swapable, routeType, fee } = calcResult ?? {}
        const { amountIn, maxAmountIn } = (calcResult?.info ?? {}) as { amountIn?: string; maxAmountIn?: string }
        swapAtom.set({
          fee,
          routes,
          priceImpact,
          executionPrice,
          currentPrice,
          minReceived: undefined,
          maxSpent: maxAmountIn,
          swapable,
          routeType,
          ...{ [focusSide === 'coin1' ? 'coin2Amount' : 'coin1Amount']: amountIn }
        })
      }
    } catch (err) {
      console.error(err)
    }
  }, [
    upCoin,
    downCoin,
    upCoinAmount,
    downCoinAmount,
    directionReversed,
    focusSide,
    slippageTolerance,
    connection,
    pathname,
    refreshCount,
    connected, // init fetch data
    jsonInfos
  ])
}

const sdkParsedInfoCache = new Map<HexAddress, SDKParsedLiquidityInfo[]>()

type SwapCalculatorInfo = {
  executionPrice: ReturnType<typeof Trade['getBestAmountOut']>['executionPrice']
  currentPrice: ReturnType<typeof Trade['getBestAmountOut']>['currentPrice']
  priceImpact: ReturnType<typeof Trade['getBestAmountOut']>['priceImpact']
  routes: ReturnType<typeof Trade['getBestAmountOut']>['routes']
  routeType: ReturnType<typeof Trade['getBestAmountOut']>['routeType']
  fee: ReturnType<typeof Trade['getBestAmountOut']>['fee']
  swapable: boolean
  info: { amountOut: string; minAmountOut: string } | { amountIn: string; maxAmountIn: string }
}

function cleanCalcCache() {
  sdkParsedInfoCache.clear()
}

async function calculatePairTokenAmount({
  upCoin,
  upCoinAmount,
  downCoin,
  downCoinAmount,
  focusSide,
  connection,
  slippageTolerance
}: {
  upCoin: SplToken
  upCoinAmount: Numberish | undefined
  downCoin: SplToken
  downCoinAmount: Numberish | undefined
  focusSide: 'up' | 'down'
  connection: Connection
  slippageTolerance: Numberish
}): Promise<SwapCalculatorInfo | undefined> {
  const upCoinTokenAmount = toTokenAmount(upCoin, upCoinAmount, { alreadyDecimaled: true })
  const downCoinTokenAmount = toTokenAmount(downCoin, downCoinAmount, { alreadyDecimaled: true })

  const { routeRelated: jsonInfos } = await liquidityAtom.get().findLiquidityInfoByTokenMint(upCoin.mint, downCoin.mint)

  if (jsonInfos.length) {
    const key = jsonInfos.map((jsonInfo) => jsonInfo.id).join('-')
    const sdkParsedInfos = sdkParsedInfoCache.has(key)
      ? sdkParsedInfoCache.get(key)!
      : await (async () => {
          const sdkParsed = await sdkParseJsonLiquidityInfo(jsonInfos, connection)
          sdkParsedInfoCache.set(key, sdkParsed)
          return sdkParsed
        })()

    const pools = jsonInfos.map((jsonInfo, idx) => ({
      poolKeys: jsonInfo2PoolKeys(jsonInfo),
      poolInfo: sdkParsedInfos[idx]
    }))

    const { amountOut, minAmountOut, executionPrice, currentPrice, priceImpact, routes, routeType, fee } =
      Trade.getBestAmountOut({
        pools,
        currencyOut: deUIToken(downCoin),
        amountIn: deUITokenAmount(upCoinTokenAmount),
        slippage: toPercent(slippageTolerance)
      })
    // console.log('{ amountOut, minAmountOut, executionPrice, currentPrice, priceImpact, routes, routeType, fee }: ', {
    //   amountOut,
    //   minAmountOut,
    //   executionPrice,
    //   currentPrice,
    //   priceImpact,
    //   routes,
    //   routeType,
    //   fee
    // })

    const sdkParsedInfoMap = new Map(sdkParsedInfos.map((info) => [toPubString(info.id), info]))
    const choosedSdkParsedInfos = shakeUndifindedItem(
      routes.map((route) => sdkParsedInfoMap.get(toPubString(route.keys.id)))
    )

    const swapable = choosedSdkParsedInfos.every((info) => Liquidity.getEnabledFeatures(info).swap)
    return {
      executionPrice,
      currentPrice,
      priceImpact,
      routes,
      routeType,
      swapable,
      fee,
      info: {
        amountOut: toUITokenAmount(amountOut).toExact(),
        minAmountOut: toUITokenAmount(minAmountOut).toExact()
      }
    }
  }
}
