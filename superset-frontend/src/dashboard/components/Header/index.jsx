/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
/* eslint-env browser */
import { extendedDayjs } from 'src/utils/dates';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  styled,
  css,
  isFeatureEnabled,
  FeatureFlag,
  t,
  getExtensionsRegistry,
  useTheme,
} from '@superset-ui/core';
import { Global } from '@emotion/react';
import { shallowEqual, useDispatch, useSelector } from 'react-redux';
import { bindActionCreators } from 'redux';
import {
  LOG_ACTIONS_PERIODIC_RENDER_DASHBOARD,
  LOG_ACTIONS_FORCE_REFRESH_DASHBOARD,
  LOG_ACTIONS_TOGGLE_EDIT_DASHBOARD,
} from 'src/logger/LogUtils';
import { Icons } from 'src/components/Icons';
import { Button } from 'src/components/';
import { findPermission } from 'src/utils/findPermission';
import { Tooltip } from 'src/components/Tooltip';
import { safeStringify } from 'src/utils/safeStringify';
import PublishedStatus from 'src/dashboard/components/PublishedStatus';
import UndoRedoKeyListeners from 'src/dashboard/components/UndoRedoKeyListeners';
import PropertiesModal from 'src/dashboard/components/PropertiesModal';
import {
  UNDO_LIMIT,
  SAVE_TYPE_OVERWRITE,
  DASHBOARD_POSITION_DATA_LIMIT,
  DASHBOARD_HEADER_ID,
} from 'src/dashboard/util/constants';
import setPeriodicRunner, {
  stopPeriodicRender,
} from 'src/dashboard/util/setPeriodicRunner';
import ReportModal from 'src/features/reports/ReportModal';
import DeleteModal from 'src/components/DeleteModal';
import { deleteActiveReport } from 'src/features/reports/ReportModal/actions';
import { PageHeaderWithActions } from 'src/components/PageHeaderWithActions';
import DashboardEmbedModal from '../EmbeddedModal';
import OverwriteConfirm from '../OverwriteConfirm';
import {
  addDangerToast,
  addSuccessToast,
  addWarningToast,
} from '../../../components/MessageToasts/actions';
import {
  dashboardTitleChanged,
  redoLayoutAction,
  undoLayoutAction,
  updateDashboardTitle,
  clearDashboardHistory,
} from '../../actions/dashboardLayout';
import {
  fetchCharts,
  fetchFaveStar,
  maxUndoHistoryToast,
  onChange,
  onRefresh,
  saveDashboardRequest,
  saveFaveStar,
  savePublished,
  setEditMode,
  setMaxUndoHistoryExceeded,
  setRefreshFrequency,
  setUnsavedChanges,
  updateCss,
} from '../../actions/dashboardState';
import { logEvent } from '../../../logger/actions';
import { dashboardInfoChanged } from '../../actions/dashboardInfo';
import isDashboardLoading from '../../util/isDashboardLoading';
import { useChartIds } from '../../util/charts/useChartIds';
import { useDashboardMetadataBar } from './useDashboardMetadataBar';
import { useHeaderActionsMenu } from './useHeaderActionsDropdownMenu';
import Modal from 'src/components/Modal';
import { Checkbox } from 'src/components';
import  { RootState } from 'src/dashboard/types';
import { Popover } from 'antd';
import html2pdf from 'html2pdf.js';
import { jsPDF } from 'jspdf';
import * as echarts from 'echarts';
import html2canvas from 'html2canvas';


const extensionsRegistry = getExtensionsRegistry();

const headerContainerStyle = theme => css`
  border-bottom: 1px solid ${theme.colors.grayscale.light2};
`;

const editButtonStyle = theme => css`
  color: ${theme.colors.primary.dark2};
`;

const actionButtonsStyle = theme => css`
  display: flex;
  align-items: center;

  .action-schedule-report {
    margin-left: ${theme.gridUnit * 2}px;
  }

  .undoRedo {
    display: flex;
    margin-right: ${theme.gridUnit * 2}px;
  }
`;

const StyledUndoRedoButton = styled(Button)`
  // TODO: check if we need this
  padding: 0;
  &:hover {
    background: transparent;
  }
`;

const undoRedoStyle = theme => css`
  color: ${theme.colors.grayscale.light1};
  &:hover {
    color: ${theme.colors.grayscale.base};
  }
`;

const undoRedoEmphasized = theme => css`
  color: ${theme.colors.grayscale.base};
`;

const undoRedoDisabled = theme => css`
  color: ${theme.colors.grayscale.light2};
`;

const saveBtnStyle = theme => css`
  min-width: ${theme.gridUnit * 17}px;
  height: ${theme.gridUnit * 8}px;
  span > :first-of-type {
    margin-right: 0;
  }
`;

const discardBtnStyle = theme => css`
  min-width: ${theme.gridUnit * 22}px;
  height: ${theme.gridUnit * 8}px;
`;

const discardChanges = () => {
  const url = new URL(window.location.href);

  url.searchParams.delete('edit');
  window.location.assign(url);
};

const Header = () => {
  const [isReportsModalVisible, setReportsModalVisible] = useState(false);
  const [activeTab, setActiveTab] = useState('filters');
  const [reportFormat, setReportFormat] = useState('image');
  const [titleType, setTitleType] = useState('default');
  const [reportTitle, setReportTitle] = useState('Untitled Report');
  const allNativeFilters = useSelector(state => state.nativeFilters.filters);

  const openReportsModal = () => setReportsModalVisible(true);
  const closeReportsModal = () => setReportsModalVisible(false);

  const theme = useTheme();
  const dispatch = useDispatch();
  const [didNotifyMaxUndoHistoryToast, setDidNotifyMaxUndoHistoryToast] =
    useState(false);
  const [emphasizeUndo, setEmphasizeUndo] = useState(false);
  const [emphasizeRedo, setEmphasizeRedo] = useState(false);
  const [showingPropertiesModal, setShowingPropertiesModal] = useState(false);
  const [showingEmbedModal, setShowingEmbedModal] = useState(false);
  const [showingReportModal, setShowingReportModal] = useState(false);
  const [currentReportDeleting, setCurrentReportDeleting] = useState(null);
  const dashboardInfo = useSelector(state => state.dashboardInfo);
  const layout = useSelector(state => state.dashboardLayout.present);
  const undoLength = useSelector(state => state.dashboardLayout.past.length);
  const redoLength = useSelector(state => state.dashboardLayout.future.length);
  const dataMask = useSelector(state => state.dataMask);
  const user = useSelector(state => state.user);
  const chartIds = useChartIds();
  const [selectedFilterIds, setSelectedFilterIds] = useState([]);
  const [isPopoverVisible, setIsPopoverVisible] = useState(false);

  //Handle checkbox toggle
  const toggleFilterSelection = filterId => {
    setSelectedFilterIds(prev =>
      prev.includes(filterId)
        ? prev.filter(id => id !== filterId)
        : [...prev, filterId],
    );
  };  

    const appliedFilters = useMemo(() => {
    
      return (
        Object.entries(dataMask || {})
          .filter(([filterId]) => filterId.startsWith('NATIVE_FILTER-'))
          .map(([filterId, filterData]) => {
            const filterDefinition = allNativeFilters?.[filterId];
            const label = filterDefinition?.label || filterDefinition?.name || filterId;
    
            const rawValue = filterData?.filterState?.value;
            const value = Array.isArray(rawValue)
              ? rawValue
              : rawValue != null
              ? [rawValue]
              : [];
    
            return { id: filterId, label, value };
          })
          .filter(f => f.value.length)
      );
    }, [dataMask, allNativeFilters]);

  const formatMenu = (
    <div
      onClick={e => e.stopPropagation()}
      style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}
    >
    <Button
        buttonStyle="link"
        style={{
          display: 'block',
          textAlign: 'left',
          color: 'black', 
          backgroundColor: '#f5f5f5', 
          padding: '8px', 
        }}
        onClick={() => {
          console.log('Save as Image');
          console.log('Filters:', selectedFilterIds);
          console.log('Charts:', selectedChartIds);
          setIsPopoverVisible(false);
          setTimeout(() => {
            closeReportsModal();
          }, 0);
        }}
      >
        {t('Download Image')}
      </Button>

      <Button
      buttonStyle="link"
      style={{
        display: 'block', 
        textAlign: 'left',
        color: 'black',
        backgroundColor: '#f5f5f5',
        padding: '8px',
      }}
      onClick={() => {
        setIsPopoverVisible(false);
        setTimeout(() => {
          handleSaveAsPDF();
          closeReportsModal();
        }, 300); // Small delay to ensure PDF starts properly before modal closes
      }}
    >
      {t('Download as PDF')}
</Button>

    </div>
   );

    // track which chart panels are selected
    const [selectedChartIds, setSelectedChartIds] = useState([]);

    // toggle a panel’s inclusion in the selection
    const toggleChartSelection = panelId => {
      setSelectedChartIds(prev =>
        prev.includes(panelId)
          ? prev.filter(id => id !== panelId)
          : [...prev, panelId],
      );
    };

   // selecting charts to be included in the report, now including layout metadata
  const chartPanels = useSelector(state => {
    const layoutItems = Object.values(state.dashboardLayout.present || {});
    console.log('⭑ dashboardLayout.present items:', layoutItems);
    return layoutItems
      .filter(item => item?.meta && typeof item.meta.chartId === 'number')
      .map(item => ({
        id: item.id,
        chartId: item.meta.chartId,
        title:
          item.meta.sliceNameOverride ||
          item.meta.sliceName ||
          `Chart ${item.meta.chartId}`,
        layout: item.layout || item.component?.props?.layout || { x: 0, y: 0, w: 1, h: 1 },
        altLayout1: item.component?.props?.layout,
        altLayout2: item.props?.layout,
        altLayout3: item.meta?.position,
      }));
  });
  useEffect(() => {
    if (!isReportsModalVisible && isPopoverVisible) {
      setIsPopoverVisible(false);
    }
  }, [isReportsModalVisible, isPopoverVisible]);


  const {
    expandedSlices,
    refreshFrequency,
    shouldPersistRefreshFrequency,
    customCss,
    colorNamespace,
    colorScheme,
    isStarred,
    isPublished,
    hasUnsavedChanges,
    maxUndoHistoryExceeded,
    editMode,
    lastModifiedTime,
  } = useSelector(
    state => ({
      expandedSlices: state.dashboardState.expandedSlices,
      refreshFrequency: state.dashboardState.refreshFrequency,
      shouldPersistRefreshFrequency:
        !!state.dashboardState.shouldPersistRefreshFrequency,
      customCss: state.dashboardState.css,
      colorNamespace: state.dashboardState.colorNamespace,
      colorScheme: state.dashboardState.colorScheme,
      isStarred: !!state.dashboardState.isStarred,
      isPublished: !!state.dashboardState.isPublished,
      hasUnsavedChanges: !!state.dashboardState.hasUnsavedChanges,
      maxUndoHistoryExceeded: !!state.dashboardState.maxUndoHistoryExceeded,
      editMode: !!state.dashboardState.editMode,
      lastModifiedTime: state.lastModifiedTime,
    }),
    shallowEqual,
  );
  const isLoading = useSelector(state => isDashboardLoading(state.charts));

  const refreshTimer = useRef(0);
  const ctrlYTimeout = useRef(0);
  const ctrlZTimeout = useRef(0);

  const dashboardTitle = layout[DASHBOARD_HEADER_ID]?.meta?.text;
  const { slug } = dashboardInfo;
  const actualLastModifiedTime = Math.max(
    lastModifiedTime,
    dashboardInfo.last_modified_time,
  );
  const boundActionCreators = useMemo(
    () =>
      bindActionCreators(
        {
          addSuccessToast,
          addDangerToast,
          addWarningToast,
          onUndo: undoLayoutAction,
          onRedo: redoLayoutAction,
          clearDashboardHistory,
          setEditMode,
          setUnsavedChanges,
          fetchFaveStar,
          saveFaveStar,
          savePublished,
          fetchCharts,
          updateDashboardTitle,
          updateCss,
          onChange,
          onSave: saveDashboardRequest,
          setMaxUndoHistoryExceeded,
          maxUndoHistoryToast,
          logEvent,
          setRefreshFrequency,
          onRefresh,
          dashboardInfoChanged,
          dashboardTitleChanged,
        },
        dispatch,
      ),
    [dispatch],
  );

  const startPeriodicRender = useCallback(
    interval => {
      let intervalMessage;

      if (interval) {
        const periodicRefreshOptions =
          dashboardInfo.common?.conf?.DASHBOARD_AUTO_REFRESH_INTERVALS;
        const predefinedValue = periodicRefreshOptions.find(
          option => Number(option[0]) === interval / 1000,
        );

        if (predefinedValue) {
          intervalMessage = t(predefinedValue[1]);
        } else {
          intervalMessage = extendedDayjs
            .duration(interval, 'millisecond')
            .humanize();
        }
      }

      const fetchCharts = (charts, force = false) =>
        boundActionCreators.fetchCharts(
          charts,
          force,
          interval * 0.2,
          dashboardInfo.id,
        );

      const periodicRender = () => {
        const { metadata } = dashboardInfo;
        const immune = metadata.timed_refresh_immune_slices || [];
        const affectedCharts = chartIds.filter(
          chartId => immune.indexOf(chartId) === -1,
        );

        boundActionCreators.logEvent(LOG_ACTIONS_PERIODIC_RENDER_DASHBOARD, {
          interval,
          chartCount: affectedCharts.length,
        });
        boundActionCreators.addWarningToast(
          t(
            `This dashboard is currently auto refreshing; the next auto refresh will be in %s.`,
            intervalMessage,
          ),
        );
        if (
          dashboardInfo.common?.conf?.DASHBOARD_AUTO_REFRESH_MODE === 'fetch'
        ) {
          // force-refresh while auto-refresh in dashboard
          return fetchCharts(affectedCharts);
        }
        return fetchCharts(affectedCharts, true);
      };

      refreshTimer.current = setPeriodicRunner({
        interval,
        periodicRender,
        refreshTimer: refreshTimer.current,
      });
    },
    [boundActionCreators, chartIds, dashboardInfo],
  );

  useEffect(() => {
    startPeriodicRender(refreshFrequency * 1000);
  }, [refreshFrequency, startPeriodicRender]);

  useEffect(() => {
    if (UNDO_LIMIT - undoLength <= 0 && !didNotifyMaxUndoHistoryToast) {
      setDidNotifyMaxUndoHistoryToast(true);
      boundActionCreators.maxUndoHistoryToast();
    }
    if (undoLength > UNDO_LIMIT && !maxUndoHistoryExceeded) {
      boundActionCreators.setMaxUndoHistoryExceeded();
    }
  }, [
    boundActionCreators,
    didNotifyMaxUndoHistoryToast,
    maxUndoHistoryExceeded,
    undoLength,
  ]);

  useEffect(
    () => () => {
      stopPeriodicRender(refreshTimer.current);
      boundActionCreators.setRefreshFrequency(0);
      clearTimeout(ctrlYTimeout.current);
      clearTimeout(ctrlZTimeout.current);
    },
    [boundActionCreators],
  );

  const handleChangeText = useCallback(
    nextText => {
      if (nextText && dashboardTitle !== nextText) {
        boundActionCreators.updateDashboardTitle(nextText);
        boundActionCreators.onChange();
      }
    },
    [boundActionCreators, dashboardTitle],
  );

  const handleCtrlY = useCallback(() => {
    boundActionCreators.onRedo();
    setEmphasizeRedo(true);
    if (ctrlYTimeout.current) {
      clearTimeout(ctrlYTimeout.current);
    }
    ctrlYTimeout.current = setTimeout(() => {
      setEmphasizeRedo(false);
    }, 100);
  }, [boundActionCreators]);

  const handleCtrlZ = useCallback(() => {
    boundActionCreators.onUndo();
    setEmphasizeUndo(true);
    if (ctrlZTimeout.current) {
      clearTimeout(ctrlZTimeout.current);
    }
    ctrlZTimeout.current = setTimeout(() => {
      setEmphasizeUndo(false);
    }, 100);
  }, [boundActionCreators]);

  const forceRefresh = useCallback(() => {
    if (!isLoading) {
      boundActionCreators.logEvent(LOG_ACTIONS_FORCE_REFRESH_DASHBOARD, {
        force: true,
        interval: 0,
        chartCount: chartIds.length,
      });
      return boundActionCreators.onRefresh(chartIds, true, 0, dashboardInfo.id);
    }
    return false;
  }, [boundActionCreators, chartIds, dashboardInfo.id, isLoading]);

  const toggleEditMode = useCallback(() => {
    boundActionCreators.logEvent(LOG_ACTIONS_TOGGLE_EDIT_DASHBOARD, {
      edit_mode: !editMode,
    });
    boundActionCreators.setEditMode(!editMode);
  }, [boundActionCreators, editMode]);

  const overwriteDashboard = useCallback(() => {
    const currentColorNamespace =
      dashboardInfo?.metadata?.color_namespace || colorNamespace;
    const currentColorScheme =
      dashboardInfo?.metadata?.color_scheme || colorScheme;

    const data = {
      certified_by: dashboardInfo.certified_by,
      certification_details: dashboardInfo.certification_details,
      css: customCss,
      dashboard_title: dashboardTitle,
      last_modified_time: actualLastModifiedTime,
      owners: dashboardInfo.owners,
      roles: dashboardInfo.roles,
      slug,
      metadata: {
        ...dashboardInfo?.metadata,
        color_namespace: currentColorNamespace,
        color_scheme: currentColorScheme,
        positions: layout,
        refresh_frequency: shouldPersistRefreshFrequency
          ? refreshFrequency
          : dashboardInfo.metadata?.refresh_frequency,
      },
    };

    // make sure positions data less than DB storage limitation:
    const positionJSONLength = safeStringify(layout).length;
    const limit =
      dashboardInfo.common?.conf?.SUPERSET_DASHBOARD_POSITION_DATA_LIMIT ||
      DASHBOARD_POSITION_DATA_LIMIT;
    if (positionJSONLength >= limit) {
      boundActionCreators.addDangerToast(
        t(
          'Your dashboard is too large. Please reduce its size before saving it.',
        ),
      );
    } else {
      if (positionJSONLength >= limit * 0.9) {
        boundActionCreators.addWarningToast(
          t('Your dashboard is near the size limit.'),
        );
      }

      boundActionCreators.onSave(data, dashboardInfo.id, SAVE_TYPE_OVERWRITE);
    }
  }, [
    actualLastModifiedTime,
    boundActionCreators,
    colorNamespace,
    colorScheme,
    customCss,
    dashboardInfo.certification_details,
    dashboardInfo.certified_by,
    dashboardInfo.common?.conf?.SUPERSET_DASHBOARD_POSITION_DATA_LIMIT,
    dashboardInfo.id,
    dashboardInfo.metadata,
    dashboardInfo.owners,
    dashboardInfo.roles,
    dashboardTitle,
    layout,
    refreshFrequency,
    shouldPersistRefreshFrequency,
    slug,
  ]);

  const showPropertiesModal = useCallback(() => {
    setShowingPropertiesModal(true);
  }, []);

  const hidePropertiesModal = useCallback(() => {
    setShowingPropertiesModal(false);
  }, []);

  const showEmbedModal = useCallback(() => {
    setShowingEmbedModal(true);
  }, []);

  const hideEmbedModal = useCallback(() => {
    setShowingEmbedModal(false);
  }, []);

  const showReportModal = useCallback(() => {
    setShowingReportModal(true);
  }, []);

  const hideReportModal = useCallback(() => {
    setShowingReportModal(false);
  }, []);

  const metadataBar = useDashboardMetadataBar(dashboardInfo);

  const userCanEdit =
    dashboardInfo.dash_edit_perm && !dashboardInfo.is_managed_externally;
  const userCanShare = dashboardInfo.dash_share_perm;
  const userCanSaveAs = dashboardInfo.dash_save_perm;
  const userCanCurate =
    isFeatureEnabled(FeatureFlag.EmbeddedSuperset) &&
    findPermission('can_set_embedded', 'Dashboard', user.roles);
  const refreshLimit =
    dashboardInfo.common?.conf?.SUPERSET_DASHBOARD_PERIODICAL_REFRESH_LIMIT;
  const refreshWarning =
    dashboardInfo.common?.conf
      ?.SUPERSET_DASHBOARD_PERIODICAL_REFRESH_WARNING_MESSAGE;
  const isEmbedded = !dashboardInfo?.userId;

  const handleOnPropertiesChange = useCallback(
    updates => {
      boundActionCreators.dashboardInfoChanged({
        slug: updates.slug,
        metadata: JSON.parse(updates.jsonMetadata || '{}'),
        certified_by: updates.certifiedBy,
        certification_details: updates.certificationDetails,
        owners: updates.owners,
        roles: updates.roles,
      });
      boundActionCreators.setUnsavedChanges(true);
      boundActionCreators.dashboardTitleChanged(updates.title);
    },
    [boundActionCreators],
  );

  const NavExtension = extensionsRegistry.get('dashboard.nav.right');

  const editableTitleProps = useMemo(
    () => ({
      title: dashboardTitle,
      canEdit: userCanEdit && editMode,
      onSave: handleChangeText,
      placeholder: t('Add the name of the dashboard'),
      label: t('Dashboard title'),
      showTooltip: false,
    }),
    [dashboardTitle, editMode, handleChangeText, userCanEdit],
  );

  const certifiedBadgeProps = useMemo(
    () => ({
      certifiedBy: dashboardInfo.certified_by,
      details: dashboardInfo.certification_details,
    }),
    [dashboardInfo.certification_details, dashboardInfo.certified_by],
  );

  const faveStarProps = useMemo(
    () => ({
      itemId: dashboardInfo.id,
      fetchFaveStar: boundActionCreators.fetchFaveStar,
      saveFaveStar: boundActionCreators.saveFaveStar,
      isStarred,
      showTooltip: true,
    }),
    [
      boundActionCreators.fetchFaveStar,
      boundActionCreators.saveFaveStar,
      dashboardInfo.id,
      isStarred,
    ],
  );

  const titlePanelAdditionalItems = useMemo(
    () => [
      !editMode && (
        <PublishedStatus
          dashboardId={dashboardInfo.id}
          isPublished={isPublished}
          savePublished={boundActionCreators.savePublished}
          userCanEdit={userCanEdit}
          userCanSave={userCanSaveAs}
          visible={!editMode}
        />
      ),
      !editMode && !isEmbedded && metadataBar,
    ],
    [
      boundActionCreators.savePublished,
      dashboardInfo.id,
      editMode,
      metadataBar,
      isEmbedded,
      isPublished,
      userCanEdit,
      userCanSaveAs,
    ],
  );

  const rightPanelAdditionalItems = useMemo(
    () => (
      <div className="button-container">
        {userCanSaveAs && (
          <div className="button-container" data-test="dashboard-edit-actions">
            {editMode && (
              <div css={actionButtonsStyle}>
                <div className="undoRedo">
                  <Tooltip
                    id="dashboard-undo-tooltip"
                    title={t('Undo the action')}
                  >
                    <StyledUndoRedoButton
                      buttonStyle="link"
                      disabled={undoLength < 1}
                      onClick={undoLength && boundActionCreators.onUndo}
                    >
                      <Icons.Undo
                        css={[
                          undoRedoStyle,
                          emphasizeUndo && undoRedoEmphasized,
                          undoLength < 1 && undoRedoDisabled,
                        ]}
                        data-test="undo-action"
                        iconSize="xl"
                      />
                    </StyledUndoRedoButton>
                  </Tooltip>
                  <Tooltip
                    id="dashboard-redo-tooltip"
                    title={t('Redo the action')}
                  >
                    <StyledUndoRedoButton
                      buttonStyle="link"
                      disabled={redoLength < 1}
                      onClick={redoLength && boundActionCreators.onRedo}
                    >
                      <Icons.Redo
                        css={[
                          undoRedoStyle,
                          emphasizeRedo && undoRedoEmphasized,
                          redoLength < 1 && undoRedoDisabled,
                        ]}
                        data-test="redo-action"
                        iconSize="xl"
                      />
                    </StyledUndoRedoButton>
                  </Tooltip>
                </div>
                <Button
                  css={discardBtnStyle}
                  buttonSize="small"
                  onClick={discardChanges}
                  buttonStyle="default"
                  data-test="discard-changes-button"
                  aria-label={t('Discard')}
                >
                  {t('Discard')}
                </Button>
                <Button
                  css={saveBtnStyle}
                  buttonSize="small"
                  disabled={!hasUnsavedChanges}
                  buttonStyle="primary"
                  onClick={overwriteDashboard}
                  data-test="header-save-button"
                  aria-label={t('Save')}
                >
                  <Icons.SaveOutlined
                    iconColor={hasUnsavedChanges && theme.colors.primary.light5}
                    iconSize="m"
                  />
                  {t('Save')}
                </Button>
              </div>
            )}
          </div>
        )}
        {editMode ? (
          <UndoRedoKeyListeners onUndo={handleCtrlZ} onRedo={handleCtrlY} />
        ) : (
          
          <div css={actionButtonsStyle}>
            {NavExtension && <NavExtension />}
  
            {/* ✅ Reports button */}
            <Button
              buttonStyle="secondary"
              onClick={openReportsModal}
              data-test="reports-button"
              className="action-button"
              css={editButtonStyle}
              aria-label={t('Reports')}
            >
              {t('Reports')}
            </Button>
            {userCanEdit && (
              <Button
                buttonStyle="secondary"
                onClick={() => {
                  toggleEditMode();
                  boundActionCreators.clearDashboardHistory?.();
                }}
                data-test="edit-dashboard-button"
                className="action-button"
                css={editButtonStyle}
                aria-label={t('Edit dashboard')}
              >
                {t('Edit dashboard')}
              </Button>
            )}
          </div>

        )}
      </div>
    ),
    [
      NavExtension,
      boundActionCreators.onRedo,
      boundActionCreators.onUndo,
      boundActionCreators.clearDashboardHistory,
      editMode,
      emphasizeRedo,
      emphasizeUndo,
      handleCtrlY,
      handleCtrlZ,
      hasUnsavedChanges,
      overwriteDashboard,
      redoLength,
      toggleEditMode,
      undoLength,
      userCanEdit,
      userCanSaveAs,
    ],
  );
  const handleReportDelete = async report => {
    await dispatch(deleteActiveReport(report));
    setCurrentReportDeleting(null);
  };

  const [menu, isDropdownVisible, setIsDropdownVisible] = useHeaderActionsMenu({
    addSuccessToast: boundActionCreators.addSuccessToast,
    addDangerToast: boundActionCreators.addDangerToast,
    dashboardInfo,
    dashboardId: dashboardInfo.id,
    dashboardTitle,
    dataMask,
    layout,
    expandedSlices,
    customCss,
    colorNamespace,
    colorScheme,
    onSave: boundActionCreators.onSave,
    onChange: boundActionCreators.onChange,
    forceRefreshAllCharts: forceRefresh,
    startPeriodicRender,
    refreshFrequency,
    shouldPersistRefreshFrequency,
    setRefreshFrequency: boundActionCreators.setRefreshFrequency,
    updateCss: boundActionCreators.updateCss,
    editMode,
    hasUnsavedChanges,
    userCanEdit,
    userCanShare,
    userCanSave: userCanSaveAs,
    userCanCurate,
    isLoading,
    showReportModal,
    showPropertiesModal,
    setCurrentReportDeleting,
    manageEmbedded: showEmbedModal,
    refreshLimit,
    refreshWarning,
    lastModifiedTime: actualLastModifiedTime,
    logEvent: boundActionCreators.logEvent,
  });

  const handleSaveAsPDF = async () => {
    // 1) Only selected charts
    const selectedPanels = chartPanels.filter(c => selectedChartIds.includes(c.id));
    if (!selectedPanels.length) {
      console.error('No charts selected.');
      return;
    }
    
    // 2) PDF setup
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 20;
    const spacing = 10;
    const headerHeight = 40;
    const titleHeight = 16;
    
    // Background + header
    pdf.setFillColor(248, 249, 250);
    pdf.rect(0, 0, pageWidth, pageHeight, 'F');
    pdf.setFillColor('#003366');
    pdf.rect(0, 0, pageWidth, headerHeight, 'F');
    pdf.setFont('helvetica', 'bold').setFontSize(12).setTextColor('#fff');
    const dateStr = new Date().toLocaleString('en-US', {
      weekday: 'short', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    pdf.text('Wandikweza Reports', margin, 25);
    const titleText = reportTitle || 'Untitled Report';
    const tw = pdf.getTextWidth(titleText);
    pdf.text(titleText, (pageWidth - tw) / 2, 25);
    const rw = pdf.getTextWidth(dateStr);
    pdf.text(dateStr, pageWidth - margin - rw, 25);
    
    // 3) Measure charts
    const measured = await Promise.all(
      chartPanels
        .filter(c => selectedChartIds.includes(c.id))
        .map(async chart => {
          const el = document.querySelector(`[data-test-chart-id="${chart.chartId}"]`);
          const rect = el?.getBoundingClientRect() || { top: headerHeight + margin, width: 1, height: 1 };
          return {
            ...chart,
            rowPx: rect.top,
            wPx: rect.width,
            hPx: rect.height,
            ratio: rect.width / rect.height,
            el,
          };
        })
    );
    
    // 4) Group into rows by rowPx
    const rows = [];
    measured.forEach(chart => {
      let row = rows.find(r => Math.abs(r.key - chart.rowPx) < 20);
      if (row) {
        row.items.push(chart);
      } else {
        rows.push({ key: chart.rowPx, items: [chart] });
      }
    });
    rows.sort((a, b) => a.key - b.key);
    
    // 5) Render rows
    let cursorY = headerHeight + margin + 20;
    for (const { items } of rows) {
      const availableWidth = pageWidth - margin * 2 - spacing * (items.length - 1);
      const sumRatios = items.reduce((sum, c) => sum + c.ratio, 0);
      let H = availableWidth / sumRatios;
    
      const availableRowHeight = pageHeight / 3;
      const maxChartHeight = availableRowHeight - titleHeight;
      if (H > maxChartHeight) H = maxChartHeight;
    
      let cursorX = margin;
      const rowHeight = titleHeight + H;
    
      for (const chart of items) {
        if (!chart.el) {
          console.warn(`Element not found for chart ${chart.chartId} (${chart.title})`);
          continue;
        }
    
        const displayH = H;
        const displayW = chart.ratio * H;
    
        // Hide menu buttons
        const dots = Array.from(chart.el.querySelectorAll('button')).filter(b =>
          (b.getAttribute('aria-label') || '').toLowerCase().includes('more') || b.textContent.trim() === '…'
        );
        const origDots = dots.map(b => b.style.display);
        dots.forEach(b => (b.style.display = 'none'));
    
        // Hide Superset-rendered titles
        const titleEls = Array.from(chart.el.querySelectorAll('.header-title, .editable-title'));
        const origTitleDisplay = titleEls.map(el => el.style.display);
        titleEls.forEach(el => (el.style.display = 'none'));
    
        // Draw our custom title
        pdf.setFontSize(10).setTextColor('#000');
        const lines = pdf.splitTextToSize(chart.title, displayW);
        pdf.text(lines, cursorX, cursorY);
    
        // Snapshot chart
        let imgData = '';
        if (chart.el.querySelector('canvas')) {
          const cv = chart.el.querySelector('canvas');
          const off = document.createElement('canvas');
          off.width = cv.width;
          off.height = cv.height;
          const ctx = off.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, off.width, off.height);
          ctx.drawImage(cv, 0, 0);
          imgData = off.toDataURL();
        } else {
          const tmp = await html2canvas(chart.el, { scale: 2, backgroundColor: '#fff' });
          imgData = tmp.toDataURL();
        }
        pdf.addImage(imgData, 'PNG', cursorX, cursorY + titleHeight, displayW, displayH);
    
        // Restore hidden elements
        dots.forEach((b, i) => (b.style.display = origDots[i]));
        titleEls.forEach((el, i) => (el.style.display = origTitleDisplay[i]));
    
        cursorX += displayW + spacing;
      }
    
      cursorY += rowHeight + spacing;
      if (cursorY > pageHeight - margin) {
        pdf.addPage();
        cursorY = margin;
      }
    }
    
  
    pdf.save(`${reportTitle || 'Untitled Report'}.pdf`);
  };

    
  
  
  return (
    <div
      css={headerContainerStyle}
      data-test="dashboard-header-container"
      data-test-id={dashboardInfo.id}
      className="dashboard-header-container"
    >
      <PageHeaderWithActions
        editableTitleProps={editableTitleProps}
        certificatiedBadgeProps={certifiedBadgeProps}
        faveStarProps={faveStarProps}
        titlePanelAdditionalItems={titlePanelAdditionalItems}
        rightPanelAdditionalItems={rightPanelAdditionalItems}
        menuDropdownProps={{
          open: isDropdownVisible,
          onOpenChange: setIsDropdownVisible,
        }}
        additionalActionsMenu={menu}
        showFaveStar={user?.userId && dashboardInfo?.id}
        showTitlePanelItems
      />
      {showingPropertiesModal && (
        <PropertiesModal
          dashboardId={dashboardInfo.id}
          dashboardInfo={dashboardInfo}
          dashboardTitle={dashboardTitle}
          show={showingPropertiesModal}
          onHide={hidePropertiesModal}
          colorScheme={colorScheme}
          onSubmit={handleOnPropertiesChange}
          onlyApply
        />
      )}

      <ReportModal
        userId={user.userId}
        show={showingReportModal}
        onHide={hideReportModal}
        userEmail={user.email}
        dashboardId={dashboardInfo.id}
        creationMethod="dashboards"
      />
      {currentReportDeleting && (
        <DeleteModal
          description={t(
            'This action will permanently delete %s.',
            currentReportDeleting?.name,
          )}
          onConfirm={() => {
            if (currentReportDeleting) {
              handleReportDelete(currentReportDeleting);
            }
          }}
          onHide={() => setCurrentReportDeleting(null)}
          open
          title={t('Delete Report?')}
        />
      )}

      <OverwriteConfirm />

      {userCanCurate && (
        <DashboardEmbedModal
          show={showingEmbedModal}
          onHide={hideEmbedModal}
          dashboardId={dashboardInfo.id}
        />
      )}
      <Global
        styles={css`
          .antd5-menu-vertical {
            border-right: none;
          }
        `}
      />

    <Modal
        title={t('Generate Report')}
        visible={isReportsModalVisible}
        onHide={closeReportsModal}
        style={{ top: '20px' }}
        bodyStyle={{ padding: 0, overflow: 'hidden' }}
        footer={
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: '8px',
              position: 'sticky',
              bottom: 0,
              background: 'white',
              padding: '8px 24px',
              borderTop: 'none',
            }}
          >
            {/* Title selector on far left of footer */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'flex-start' }}>
                  <label
                    htmlFor="report-title"
                    style={{ fontWeight: 'bold', fontSize: '16px', marginRight: '8px' }}
                  >
                    {t('Title')}
                  </label>
                  <input
                    id="report-title"
                    type="text"
                    value={reportTitle}
                    onChange={e => setReportTitle(e.target.value)}
                    placeholder={t('Enter report title')}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '4px',
                      border: '1px solid #ccc',
                      width: '200px',
                      backgroundColor: reportTitle ? '#fff' : '#f5f5f5',
                      transition: 'width 0.4s ease, background-color 0.4s ease, border-color 0.4s ease',
                      outline: 'none',
                    }}
                    onFocus={e => {
                      e.target.style.backgroundColor = '#FFFFFF';
                      e.target.style.borderColor = '#18c1ff';
                      e.target.style.width = '300px';
                    }} 
                    onBlur={e => {
                      e.target.style.backgroundColor = '#fff'; 
                      e.target.style.borderColor = '#ccc';
                      e.target.style.width = '200px';
                    }}
                  />
                </div>

            <Button buttonStyle="default" onClick={closeReportsModal}>
              {t('Cancel')}
            </Button>
            <Popover
              content={formatMenu}
              placement="bottomRight"
              trigger="click"
              visible={isPopoverVisible}
              onVisibleChange={visible => setIsPopoverVisible(visible)}
              style={{ backgroundColor: '#f5f5f5' }}
            >
              <Button
                buttonStyle="primary"
                style={{ color: 'white', backgroundColor: '#1890ff' }}
              >
                {t('Save')} <span style={{ fontSize: '0.75em' }}>▼</span>
              </Button>
            </Popover>
          </div>
        }
        closeOnEscape
        showCloseButton
      >
        <div style={{ display: 'flex', height: '50vh', overflow: 'hidden' }}>
          {/* Left panel with tabs */}
          <div
            style={{
              width: '160px',
              borderRight: '1px solid #ccc',
              padding: '12px',
            }}
          >
            <div
              style={{
                cursor: 'pointer',
                marginBottom: '12px',
                fontWeight: activeTab === 'filters' ? 'bold' : 'normal',
                backgroundColor: activeTab === 'filters' ? '#f0f0f0' : 'transparent',
                padding: '8px',
                borderRadius: '4px',
              }}
              onClick={() => setActiveTab('filters')}
            >
              {t('Select Filters')}
            </div>
            <div
              style={{
                cursor: 'pointer',
                fontWeight: activeTab === 'charts' ? 'bold' : 'normal',
                backgroundColor: activeTab === 'charts' ? '#f0f0f0' : 'transparent',
                padding: '8px',
                borderRadius: '4px',
              }}
              onClick={() => setActiveTab('charts')}
            >
              {t('Select Charts')}
            </div>
          </div>

          {/* Right panel: only scroll here */}
          <div
            style={{
              flex: 1,
              padding: '12px',
              overflowY: 'auto',
            }}
          >
            {activeTab === 'filters' ? (
            <>
              {Array.isArray(appliedFilters) && appliedFilters.length > 0 ? (
                <>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '12px',
                    }}
                  >
                    <p style={{ margin: 0 }}>
                      {t('Choose filters to apply for the report')}
                    </p>
                    <div>
                      <input
                        type="checkbox"
                        id="select-all-filters"
                        checked={selectedFilterIds.length === appliedFilters.length}
                        onChange={e => {
                          if (e.target.checked) {
                            setSelectedFilterIds(appliedFilters.map(f => f.id));
                          } else {
                            setSelectedFilterIds([]);
                          }
                        }}
                      />
                      <label htmlFor="select-all-filters" style={{ marginLeft: '8px' }}>
                        {selectedFilterIds.length === appliedFilters.length
                          ? t('Deselect All')
                          : t('Select All')}
                      </label>
                    </div>
                  </div>

                  {appliedFilters.map(filter => (
                    <div key={filter.id} style={{ marginBottom: '8px' }}>
                      <input
                        type="checkbox"
                        id={`filter-${filter.id}`}
                        checked={selectedFilterIds.includes(filter.id)}
                        onChange={() => toggleFilterSelection(filter.id)}
                      />
                      <label htmlFor={`filter-${filter.id}`} style={{ marginLeft: '8px' }}>
                        {filter.label}
                      </label>
                    </div>
                  ))}
                </>
              ) : (
                <p style={{ fontStyle: 'italic', marginBottom: '8px' }}>
                  {t('No filters applied to the dashboard.')}
                </p>
              )}
            </>
          ) : (
            <>
              {Array.isArray(chartPanels) && chartPanels.length > 0 ? (
                <>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '12px',
                    }}
                  >
                    <p style={{ margin: 0 }}>
                      {t('Choose charts to include in the report')}
                    </p>
                    <div>
                      <input
                        type="checkbox"
                        id="select-all-charts"
                        checked={selectedChartIds.length === chartPanels.length}
                        onChange={e => {
                          if (e.target.checked) {
                            setSelectedChartIds(chartPanels.map(p => p.id));
                          } else {
                            setSelectedChartIds([]);
                          }
                        }}
                      />
                      <label htmlFor="select-all-charts" style={{ marginLeft: '8px' }}>
                        {selectedChartIds.length === chartPanels.length
                          ? t('Deselect All')
                          : t('Select All')}
                      </label>
                    </div>
                  </div>

                  {chartPanels.map(panel => (
                    <div key={panel.id} style={{ marginBottom: '8px' }}>
                      <input
                        type="checkbox"
                        id={`chart-${panel.id}`}
                        checked={selectedChartIds.includes(panel.id)}
                        onChange={() => toggleChartSelection(panel.id)}
                      />
                      <label htmlFor={`chart-${panel.id}`} style={{ marginLeft: '8px' }}>
                        {panel.title}
                      </label>
                    </div>
                  ))}
                </>
              ) : (
                <p style={{ fontStyle: 'italic', marginBottom: '8px' }}>
                  {t('No charts found on this dashboard.')}
                </p>
              )}
            </>
          )}
          </div>
        </div>
      </Modal>


      <div
        css={css`
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: -1;
        `}
      />

    </div>
  );
};
export default Header;
