#!/bin/bash
# Strategos CLI bash completion
# Install: source completion/strategos.bash
# Or copy to /etc/bash_completion.d/strategos

_strategos_completions() {
    local cur="${COMP_WORDS[COMP_CWORD]}"
    local prev="${COMP_WORDS[COMP_CWORD-1]}"
    local commands="onboard doctor status help version"
    local opts="--config --verbose --help --version"

    case "${COMP_CWORD}" in
        1)
            # First argument: subcommand
            COMPREPLY=($(compgen -W "${commands}" -- "${cur}"))
            return 0
            ;;
        *)
            # Subsequent arguments: options
            case "${COMP_WORDS[1]}" in
                onboard)
                    local subcmds="quickstart advanced reset help"
                    if [[ "${prev}" == "--mode" ]]; then
                        COMPREPLY=($(compgen -W "quickstart advanced" -- "${cur}"))
                    elif [[ "${prev}" == "--reset-scope" ]]; then
                        COMPREPLY=($(compgen -W "config config+creds full" -- "${cur}"))
                    else
                        COMPREPLY=($(compgen -W "${subcmds} ${opts}" -- "${cur}"))
                    fi
                    ;;
                doctor)
                    local subcmds="run fix help"
                    COMPREPLY=($(compgen -W "${subcmds} ${opts} --yes --repair" -- "${cur}"))
                    ;;
                status)
                    local subcmds="show help"
                    COMPREPLY=($(compgen -W "${subcmds} ${opts} --deep --json" -- "${cur}"))
                    ;;
                *)
                    COMPREPLY=($(compgen -W "${opts}" -- "${cur}"))
                    ;;
            esac
            return 0
            ;;
    esac
}

complete -F _strategos_completions strategos
complete -F _strategos_completions node  # for "node build/index.js" usage
