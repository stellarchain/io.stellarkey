export function applicationVerificationCommand(scripts) {
  return scripts['verify:application'].split(' && ').flatMap(command => {
    const stage = /^npm run (verify:application:[a-z-]+)$/.exec(command);
    return stage ? scripts[stage[1]].split(' && ') : [command];
  }).join(' && ');
}
