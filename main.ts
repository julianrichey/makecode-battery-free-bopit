function edges_to_bopit_action_e (button_edge: boolean, motor_edge: boolean, shaker_edge: boolean) {
    if (button_edge && !(motor_edge) && !(shaker_edge)) {
        return bopit_action_e.BOPIT_ACTION_BOP
    }
    if (!(button_edge) && motor_edge && !(shaker_edge)) {
        return bopit_action_e.BOPIT_ACTION_TWIST
    }
    if (!(button_edge) && !(motor_edge) && shaker_edge) {
        return bopit_action_e.BOPIT_ACTION_SHAKE
    }
    return bopit_action_e.BOPIT_ACTION_NUM_ACTIONS
}
function bopit_update () {
	
}
console.log("Disclaimer: figuring out what static typescript is oops")
console.log("debounce.h")
interface debounce_state {
    prev_sample: boolean,
    last_edge_time: number,
    debounce_interval: number,
    button_out: boolean
}
console.log("debounce.c")
function debounce_button(db: debounce_state, button: boolean, time_now: number) {
    if ((button == true) && (db.prev_sample == false)) {
        db.last_edge_time = time_now;
    }

    if ((button == false) && (db.prev_sample == true)) {
        db.last_edge_time = time_now;
    }

    db.prev_sample = button;

    if ((time_now - db.last_edge_time) > db.debounce_interval) {
        db.button_out = button;
    }

    return db.button_out;
}
console.log("game.h")
enum bopit_action_e {
    BOPIT_ACTION_TWIST = 0,
    BOPIT_ACTION_SHAKE = 1,
    BOPIT_ACTION_BOP = 2,
    BOPIT_ACTION_NUM_ACTIONS = 3
}
enum beat_enum_e {
    BEAT_ENUM_BEAT_1 = 0,       // "command"
    BEAT_ENUM_BEAT_1_5 = 1,     // "it"
    BEAT_ENUM_BEAT_2 = 2,       // hi-hat quarter note
    BEAT_ENUM_BEAT_3 = 3,       // bass drum eighth note
    BEAT_ENUM_BEAT_3_5 = 4,     // bass drum eighth note
    BEAT_ENUM_BEAT_4 = 5,       // hi-hat quarter note
    BEAT_ENUM_NUM_BEATS
}
interface audio_clip { //TODO - how on earth will audio work
    audio: number,
    audio_len: number
}
interface bopit_user_input { //TODO - dont understand yet
    motor_voc_q8_8: number,
    shaker_voc_q8_8: number,
    button: number //should this be boolean?
}
interface bopit_gamestate {
    t_now: number,
    t_next_beat: number,
    // false if the game is still active, true if the player has lost.
    lost: boolean,
    // Holds the next expected action. Generated on beat 2 of each measure after a successful user action.
    ms_per_eighth_note: number,
    measure_number: number,
    expected_action: bopit_action_e,
    t_this_action: number,
    t_measure_start: number,
    action_window: number, // tolerance in time-domain for beat detection
    beat_state: beat_enum_e,
    // linear-feedback shift register for random number generation
    lfsr: number,
    // Variables for keeping track of previous UI state
    bop_debouncer: debounce_state,
    button_prev: boolean,
    motor_prev: boolean,
    shaker_prev: boolean,
    tlastedge_button: number,
    tlastedge_motor: number,
    tlastedge_shaker: number,
    // If this is null, there's no sound ready to play.
    pending_audio: audio_clip //TODO
}
console.log("game.c")
let SHAKER_BACKLASH = 600
let it_clips = [0, 0, 0, 0]
let twist_clips = [0, 0, 0, 0]
let shake_clips = [0, 0, 0, 0]
let bop_clips = [0, 0, 0, 0]
let dry_kick_clip: audio_clip;
let closed_hi_hat_clip: audio_clip;
let action_to_cliptable_map = [twist_clips, shake_clips, bop_clips]
let sound_schedule = [
null,
null,
closed_hi_hat_clip,
dry_kick_clip,
dry_kick_clip,
closed_hi_hat_clip
]
function advance_lfsr(gs: bopit_gamestate) { // should work? js converts 64bit fp Numbers to 32bit signed ints before bitwise ops - scary
    let bit = gs.lfsr & 1;
    gs.lfsr >>= 1;
    if(bit) {
        gs.lfsr ^= 0xA3000000;
    }
}
let note_length_multipliers = [
1,
1,
2,
1,
1,
2,
65535
]
let speed_schedule = [
[0, 250],
[12, 227],
[24, 208],
[36, 187],
[48, 174],
[60, 163],
[72, 156],
[84, 150],
[65535, 100]
]
let motor_hysteresis = [768, 512]
let shaker_hysteresis = [2048, 512]
console.log("this is not how this will be instantiated; will happen in a constructor called from main then passed to bopit_update_state from there")
let bopit_gamestate_t = {
    t_now: 0,
    t_next_beat: 0,
    lost: 0,
    ms_per_eighth_note: speed_schedule[0][1],
    measure_number: 0,
    expected_action: bopit_action_e.BOPIT_ACTION_TWIST,
    t_this_action: 0, //gs->t_measure_start + 10 * gs->ms_per_eighth_note; //dont quite understand these yet
    t_measure_start: 0, //-((int32_t)gs->ms_per_eighth_note) * 4;
    action_window: 200,
    beat_state: beat_enum_e.BEAT_ENUM_BEAT_2,
    lfsr: 0xA5CE5b3A,
    bop_debouncer: {
        prev_sample: false,
        last_edge_time: 0,
        debounce_interval: 10,
        button_out: false
    },
    button_prev: undefined as boolean,
    motor_prev: 0,
    shaker_prev: 0,
    tlastedge_button: undefined as number,
    tlastedge_motor: undefined as number,
    tlastedge_shaker: undefined as number,
    pending_audio: undefined as audio_clip
};
function bopit_update_state(gs: bopit_gamestate, input: bopit_user_input, dt_ms: number) {
    gs.t_now += dt_ms;

    // update state variables as appropriate on beats
    if (gs.t_now >= gs.t_next_beat) {
        // advance beat state variables
        gs.beat_state++;
        if (gs.beat_state == beat_enum_e.BEAT_ENUM_NUM_BEATS) {
            gs.beat_state = beat_enum_e.BEAT_ENUM_BEAT_1;
            gs.t_measure_start = gs.t_next_beat;
        }

        // speed up if appropriate
        if (gs.beat_state == beat_enum_e.BEAT_ENUM_BEAT_1) {
            gs.measure_number++;
            let sched_slot;
            for (sched_slot = 1; speed_schedule[sched_slot][0] < gs.measure_number; sched_slot++);
            gs.ms_per_eighth_note = speed_schedule[sched_slot - 1][1];
        }

        // select proper sound to make pending
        if (gs.beat_state == beat_enum_e.BEAT_ENUM_BEAT_1) {
            for (let i = 0; i < 4; i++, advance_lfsr(gs));
            let clip_selection = (gs.lfsr & 0x03);
            //gs.pending_audio = action_to_cliptable_map[gs.expected_action][clip_selection];
        } else if (gs.beat_state == beat_enum_e.BEAT_ENUM_BEAT_1_5) {
            for (let j = 0; j < 4; j++, advance_lfsr(gs));
            let clip_selection2 = (gs.lfsr & 0x03);
            //gs.pending_audio = it_clips[clip_selection2];
        } else {
            //gs.pending_audio = sound_schedule[gs.beat_state];
        }

        // calculate next beat time
        gs.t_next_beat += note_length_multipliers[gs.beat_state] * gs.ms_per_eighth_note;

        // If we just played beat 4, schedule the next expected UI action
    } else {
        // clear pending sound
        gs.pending_audio = undefined as audio_clip;
    }
    //gs->pending_audio = NULL;

    // update ui beattimes
    let button_now = debounce_button(gs.bop_debouncer, (input.button != 0), gs.t_now);
    let motor_now = (input.motor_voc_q8_8 > motor_hysteresis[(gs.motor_prev ? 1 : 0)]);
    let shaker_now = (input.shaker_voc_q8_8 > shaker_hysteresis[(gs.shaker_prev ? 1 : 0)]);

    let button_trig = false;
    let motor_trig = false;
    let shaker_trig = false;
    if (button_now && !gs.button_prev) {
        gs.tlastedge_button = gs.t_now;
        button_trig = true;
    }
    if (motor_now && !gs.motor_prev) {
        gs.tlastedge_motor = gs.t_now;
        motor_trig = true;
    }
    if ((shaker_now && !gs.shaker_prev) && ((gs.t_now - gs.tlastedge_shaker) > SHAKER_BACKLASH)) {
        gs.tlastedge_shaker = gs.t_now;
        shaker_trig = true;
    }

    // check to see if the person missed a command
    //if (button_trig || motor_trig || shaker_trig ||
    if (motor_trig || shaker_trig ||
        (gs.t_now > (gs.t_this_action + (gs.action_window / 2)))) {
        // check that the person did the right one
        if ((edges_to_bopit_action_e(button_trig, motor_trig, shaker_trig) != gs.expected_action) ||
            (gs.t_now > (gs.t_this_action + (gs.action_window / 2))) ||
            (gs.t_now < (gs.t_this_action - (gs.action_window / 2)))) {
            gs.lost = true;
        }


        for (let k = 0; k < 4; k++, advance_lfsr(gs));

        //gs->expected_action = ((uint8_t)gs->lfsr) % BOPIT_ACTION_NUM_ACTIONS;
        //gs->expected_action = BOPIT_ACTION_TWIST;
        gs.expected_action = (gs.lfsr & 0x01) ? bopit_action_e.BOPIT_ACTION_TWIST : bopit_action_e.BOPIT_ACTION_SHAKE;

        // TODO: this logic is slightly wrong when tempo increases.
        gs.t_this_action = gs.t_measure_start + (gs.ms_per_eighth_note * 10);
    }

    gs.button_prev = button_now;
    gs.motor_prev = motor_now;
    gs.shaker_prev = shaker_now;



}
function get_pending_audio_clip(gs: bopit_gamestate) {
    return gs.pending_audio;
}
forever(function () {
    control.runInParallel(function () {
        bopit_update()
    })
    console.log("this wait should be longer than the update takes?")
    control.waitMicros(4)
})
