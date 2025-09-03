// decorationSequenceUtils.js

/**
 * Parse decoration sequence string into ordered array
 * @param {string} decoSequence - e.g., "coating_printing_foiling"
 * @returns {string[]} - e.g., ["coating", "printing", "foiling"]
 */
export const parseDecorationSequence = (decoSequence) => {
  if (!decoSequence || typeof decoSequence !== 'string') {
    return [];
  }
  return decoSequence.split('_').filter(Boolean);
};

/**
 * Get the position of a team in the decoration sequence
 * @param {string[]} sequence - parsed decoration sequence
 * @param {string} team - team name (coating, printing, foiling, frosting)
 * @returns {number} - position in sequence (-1 if not found)
 */
export const getTeamSequencePosition = (sequence, team) => {
  return sequence.indexOf(team);
};

/**
 * Get the previous team in the decoration sequence
 * @param {string[]} sequence - parsed decoration sequence
 * @param {string} currentTeam - current team name
 * @returns {string|null} - previous team name or null if first/not found
 */
export const getPreviousTeam = (sequence, currentTeam) => {
  const currentIndex = getTeamSequencePosition(sequence, currentTeam);
  if (currentIndex <= 0) return null;
  return sequence[currentIndex - 1];
};

/**
 * Get the next team in the decoration sequence
 * @param {string[]} sequence - parsed decoration sequence
 * @param {string} currentTeam - current team name
 * @returns {string|null} - next team name or null if last/not found
 */
export const getNextTeam = (sequence, currentTeam) => {
  const currentIndex = getTeamSequencePosition(sequence, currentTeam);
  if (currentIndex === -1 || currentIndex >= sequence.length - 1) return null;
  return sequence[currentIndex + 1];
};

/**
 * Check if a team can start working on a component
 * @param {Object} component - component object with decorations
 * @param {string} team - team wanting to work (coating, printing, foiling, frosting)
 * @returns {Object} - {canWork: boolean, reason: string, waitingFor: string|null}
 */
export const canTeamWork = (component, team) => {
  // If no decoration sequence, team can work
  if (!component.deco_sequence) {
    return { canWork: true, reason: 'No decoration sequence defined', waitingFor: null };
  }

  const sequence = parseDecorationSequence(component.deco_sequence);
  const teamPosition = getTeamSequencePosition(sequence, team);
  
  // Team not in sequence
  if (teamPosition === -1) {
    return { canWork: false, reason: `${team} not in decoration sequence`, waitingFor: null };
  }

  // First team in sequence can always work
  if (teamPosition === 0) {
    return { canWork: true, reason: 'First team in sequence', waitingFor: null };
  }

  // Check if previous team has dispatched
  const previousTeam = getPreviousTeam(sequence, team);
  const previousTeamStatus = component.decorations?.[previousTeam]?.status;

  if (previousTeamStatus === 'DISPATCHED') {
    return { canWork: true, reason: 'Previous team completed', waitingFor: null };
  }

  return { 
    canWork: false, 
    reason: `Waiting for ${previousTeam} to dispatch`, 
    waitingFor: previousTeam 
  };
};

/**
 * Get decoration status for a specific team
 * @param {Object} component - component object
 * @param {string} team - team name
 * @returns {string} - status or 'N/A'
 */
export const getDecorationStatus = (component, team) => {
  return component?.decorations?.[team]?.status ?? 'N/A';
};

/**
 * Check if component has decoration work for a specific team
 * @param {Object} component - component object
 * @param {string} team - team name
 * @returns {boolean}
 */
export const hasDecorationForTeam = (component, team) => {
  return component?.decorations?.[team] && 
         component?.deco_sequence?.includes(team);
};

/**
 * Get all teams that should be notified when current team dispatches
 * @param {string} decoSequence - decoration sequence
 * @param {string} currentTeam - team that just dispatched
 * @returns {string[]} - array of team names to notify
 */
export const getTeamsToNotify = (decoSequence, currentTeam) => {
  const sequence = parseDecorationSequence(decoSequence);
  const currentIndex = getTeamSequencePosition(sequence, currentTeam);
  
  // Return next team only
  const nextTeam = getNextTeam(sequence, currentTeam);
  return nextTeam ? [nextTeam] : [];
};

/**
 * Generate waiting message for team
 * @param {Object} component - component object
 * @param {string} team - current team
 * @returns {string} - waiting message
 */
export const getWaitingMessage = (component, team) => {
  const { canWork, waitingFor } = canTeamWork(component, team);
  
  if (canWork) return '';
  
  if (waitingFor) {
    const waitingStatus = getDecorationStatus(component, waitingFor);
    return `Awaiting ${waitingFor} (Status: ${waitingStatus})`;
  }
  
  return 'Cannot work on this component';
};