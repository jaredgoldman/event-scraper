import { VenueConfig } from '../types'

export const venueConfigs: Record<string, VenueConfig> = {
  'The Rex': {
    typicalShowTimes: [
      { startTime: '14:30', endTime: '16:30' },
      { startTime: '17:30', endTime: '19:30' },
      { startTime: '20:30', endTime: '21:30' },
      { startTime: '22:30', endTime: '00:30' }
    ]
  },
//   'Drom Taberna': {
//     typicalShowTimes: [
//       { startTime: '20:00', endTime: '23:00' }
//     ]
//   },
//   'Jazz Bistro': {
//     typicalShowTimes: [
//       { startTime: '19:30', endTime: '22:30' }
//     ]
//   },
//   'The Emmet Ray': {
//     typicalShowTimes: [
//       { startTime: '20:00', endTime: '23:00' }
//     ]
//   },
//   'The Reservoir Lounge': {
//     typicalShowTimes: [
//       { startTime: '20:00', endTime: '23:00' },
//       { startTime: '23:30', endTime: '02:30' }
//     ]
//   },
//   'The Pilot': {
//     typicalShowTimes: [
//       { startTime: '20:00', endTime: '23:00' }
//     ]
//   },
//   'Hirut Cafe': {
//     typicalShowTimes: [
//       { startTime: '19:00', endTime: '22:00' }
//     ]
//   },
//   'Lula Lounge': {
//     typicalShowTimes: [
//       { startTime: '20:00', endTime: '23:00' }
//     ]
//   },
//   'Poetry Jazz Cafe': {
//     typicalShowTimes: [
//       { startTime: '20:00', endTime: '23:00' }
//     ]
//   }
}

/**
 * Get venue configuration by venue name
 * @param venueName The name of the venue
 * @returns The venue configuration or undefined if not found
 */
export const getVenueConfig = (venueName: string): VenueConfig | undefined => {
  return venueConfigs[venueName]
} 