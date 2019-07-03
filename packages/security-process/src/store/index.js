import { createStore, applyMiddleware, compose } from 'redux'
import createSagaMiddleware from 'redux-saga'
import { persistStore, persistCombineReducers } from 'redux-persist'
import getStoredStateMigrateV4 from 'redux-persist/lib/integration/getStoredStateMigrateV4'
import { createHashHistory } from 'history'
import { connectRouter, routerMiddleware } from 'connected-react-router'
import { head } from 'ramda'
import Bitcoin from 'bitcoinjs-lib'
import BitcoinCash from 'bitcoinforksjs-lib'

import { coreMiddleware } from 'blockchain-wallet-v4/src'
import {
  createWalletApi,
  Socket,
  ApiSocket,
  HorizonStreamingService
} from 'blockchain-wallet-v4/src/network'
import { serializer } from 'blockchain-wallet-v4/src/types'
import { actions, rootSaga, rootReducer, selectors } from 'data'
import IPC from '../IPC'

const devToolsConfig = {
  maxAge: 1000,
  name: `Security Process`,
  serialize: serializer,
  actionsBlacklist: [
    // '@@redux-form/INITIALIZE',
    // '@@redux-form/CHANGE',
    // '@@redux-form/REGISTER_FIELD',
    // '@@redux-form/UNREGISTER_FIELD',
    // '@@redux-form/UPDATE_SYNC_ERRORS',
    // '@@redux-form/FOCUS',
    // '@@redux-form/BLUR',
    // '@@redux-form/DESTROY',
    // '@@redux-form/RESET'
  ]
}

export default IPC(async ({ imports, middleware: IPCmiddleware }) => {
  const { options, localStorage } = imports
  const history = createHashHistory()
  const sagaMiddleware = createSagaMiddleware()
  const composeEnhancers = window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__
    ? window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__(devToolsConfig)
    : compose
  const walletPath = 'wallet.payload'
  const kvStorePath = 'wallet.kvstore'
  const isAuthenticated = selectors.auth.isAuthenticated
  const apiKey = '1770d5d9-bcea-4d28-ad21-6cbd5be018a8'
  // TODO: deprecate when wallet-options-v4 is updated on prod
  const socketUrl = head(options.domains.webSocket.split('/inv'))
  const horizonUrl = options.domains.horizon
  const btcSocket = new Socket({
    options,
    url: `${socketUrl}/inv`
  })
  const bchSocket = new Socket({
    options,
    url: `${socketUrl}/bch/inv`
  })
  const ethSocket = new Socket({
    options,
    url: `${socketUrl}/eth/inv`
  })
  const ratesSocket = new ApiSocket({
    options,
    url: `${socketUrl}/nabu-gateway/markets/quotes`,
    maxReconnects: 3
  })
  const xlmStreamingService = new HorizonStreamingService({
    url: horizonUrl
  })

  const getAuthCredentials = () =>
    selectors.modules.profile.getAuthCredentials(store.getState())
  const reauthenticate = () => store.dispatch(actions.modules.profile.signIn())
  const networks = {
    btc: Bitcoin.networks[options.platforms.web.coins.BTC.config.network],
    bch: BitcoinCash.networks[options.platforms.web.coins.BTC.config.network],
    eth: options.platforms.web.coins.ETH.config.network,
    xlm: options.platforms.web.coins.XLM.config.network
  }
  const api = createWalletApi({
    imports,
    options,
    apiKey,
    getAuthCredentials,
    reauthenticate,
    networks
  })
  const persistWhitelist = ['session', 'preferences', 'cache']

  // TODO: remove getStoredStateMigrateV4 someday (at least a year from now)
  const store = createStore(
    connectRouter(history)(
      persistCombineReducers(
        {
          getStoredState: getStoredStateMigrateV4({
            storage: localStorage,
            whitelist: persistWhitelist
          }),
          key: 'root',
          storage: localStorage,
          whitelist: persistWhitelist
        },
        rootReducer
      )
    ),
    composeEnhancers(
      applyMiddleware(
        IPCmiddleware,
        sagaMiddleware,
        routerMiddleware(history),
        coreMiddleware.kvStore({ isAuthenticated, api, kvStorePath }),
        coreMiddleware.walletSync({ isAuthenticated, api, walletPath })
      )
    )
  )
  const persistor = persistStore(store, null)

  sagaMiddleware.run(rootSaga, {
    api,
    bchSocket,
    btcSocket,
    ethSocket,
    imports,
    ratesSocket,
    networks,
    options
  })

  // expose globals here
  window.createTestXlmAccounts = () => {
    store.dispatch(actions.core.data.xlm.createTestAccounts())
  }

  return {
    api,
    store,
    history,
    persistor
  }
})
