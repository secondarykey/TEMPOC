// Command version keeps the desktop app's version in sync across the files
// that carry it. Run it from `desktop/`:
//
//	go run ./_cmd/version.go 1.2.3   // set an explicit version
//	go run ./_cmd/version.go -bump   // choose patch/minor/major (Enter = patch)
//	go run ./_cmd/version.go         // re-sync the other files from `version`
//	go run ./_cmd/version.go -print  // print the current version, change nothing
//
// `version` is the single source of truth; build/config.yml and
// frontend/package.json are mirrors. The exe metadata is generated from
// config.yml by `wails3 update build-assets` — see desktop/CLAUDE.md.
//
// This lives under _cmd/ so the go tool ignores it: directories starting with
// an underscore are excluded from ./... patterns, keeping this tool out of
// `go build ./...` while `go run ./_cmd/version.go` still works.
package main

import (
	"bufio"
	"flag"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
)

// Paths are relative to desktop/, which is where this tool must be run from.
const (
	versionFile = "./version"
	configYml   = "./build/config.yml"
	packJsn     = "./frontend/package.json"
	// Anchored to the line start on purpose: config.yml carries a commented-out
	// `ios:` block containing its own `version: "0.0.1"`, and an unanchored
	// pattern would rewrite that comment into a live YAML key.
	configRg  = `^  version:\s*"([0-9]+\.[0-9]+\.[0-9]+)"`
	configFmt = `  version: "%v" # The application version`
	packRg    = `^  "version":\s*"([0-9]+\.[0-9]+\.[0-9]+)"`
	packFmt   = `  "version": "%v",`
)

const inquiry = `
Now Version: %s

  Enter   -> Patch Version
  1:Patch -> %s
  2:Minor -> %s
  3:Major -> %s
  Other   -> Cancel

Please select the upgrade version(1-3)[1]:`

type ver struct {
	major int
	minor int
	patch int
}

func parseVer(v string) *ver {
	var rtn ver
	rtn.major = -1
	rtn.minor = -1
	rtn.patch = -1
	vals := strings.Split(v, ".")
	if len(vals) == 3 {
		rtn.major = parseInt(vals[0])
		rtn.minor = parseInt(vals[1])
		rtn.patch = parseInt(vals[2])
	}
	return &rtn
}

func parseInt(v string) int {
	val, err := strconv.Atoi(v)
	if err != nil {
		return -1
	}
	return val
}

func (v ver) addMajor() *ver { return &ver{v.major + 1, 0, 0} }
func (v ver) addMinor() *ver { return &ver{v.major, v.minor + 1, 0} }
func (v ver) addPatch() *ver { return &ver{v.major, v.minor, v.patch + 1} }
func (v ver) String() string { return fmt.Sprintf("%d.%d.%d", v.major, v.minor, v.patch) }
func (v *ver) isError() bool { return v == nil || v.major == -1 }

var (
	bump     bool
	printVer bool
)

func main() {
	flag.BoolVar(&bump, "bump", false, "select the next version interactively")
	flag.BoolVar(&printVer, "print", false, "print the current version")
	flag.Parse()

	// -print touches nothing; it exists for CI and shell scripts.
	if printVer {
		v, err := parseVersion()
		if err != nil {
			fmt.Fprintf(os.Stderr, "error: %+v", err)
			os.Exit(1)
		}
		fmt.Println(v)
		return
	}

	if err := run(flag.Args()); err != nil {
		fmt.Fprintf(os.Stderr, "run() error: %+v\n", err)
		os.Exit(1)
	}
	fmt.Println("Success")
}

func run(args []string) error {
	now, err := parseVersion()
	if err != nil {
		return err
	}

	// No args, no flags: re-sync the mirrors from the current version.
	if len(args) == 0 && !bump {
		fmt.Println("Version:", now)
		return write(now)
	}

	var rtn *ver
	if bump {
		rtn = inquiryVersion(now)
	} else {
		rtn = parseVer(args[0])
	}
	if rtn.isError() {
		return fmt.Errorf("input version error")
	}

	fmt.Println("Version:", rtn)

	if err := os.WriteFile(versionFile, []byte(rtn.String()+"\n"), 0644); err != nil {
		return err
	}
	fmt.Println("Write:", versionFile)

	return write(rtn)
}

func inquiryVersion(now *ver) *ver {
	major := now.addMajor()
	minor := now.addMinor()
	patch := now.addPatch()
	fmt.Fprintf(os.Stdout, inquiry, now.String(), patch.String(), minor.String(), major.String())
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Scan()
	switch scanner.Text() {
	case "", "1":
		return patch
	case "2":
		return minor
	case "3":
		return major
	}
	return &ver{-1, -1, -1}
}

func parseVersion() (*ver, error) {
	data, err := os.ReadFile(versionFile)
	if err != nil {
		return nil, err
	}
	return parseVer(strings.TrimSpace(string(data))), nil
}

type op struct {
	input  string
	output string
	v      *ver
	rgs    []*rgSet
}

type rgSet struct {
	xp     string
	format string
	rg     *regexp.Regexp
}

func write(v *ver) error {
	ops := []*op{
		{configYml, "", v, []*rgSet{{configRg, configFmt, nil}}},
		{packJsn, "", v, []*rgSet{{packRg, packFmt, nil}}},
	}
	for _, o := range ops {
		if err := writeFile(o); err != nil {
			return err
		}
	}
	for _, o := range ops {
		if err := os.Rename(o.output, o.input); err != nil {
			return err
		}
		fmt.Println("Rename:", o.input)
	}
	return nil
}

func writeFile(o *op) error {
	for _, set := range o.rgs {
		set.rg = regexp.MustCompile(set.xp)
	}
	in, err := os.Open(o.input)
	if err != nil {
		return err
	}
	defer in.Close()

	output := o.input + "_tmp"
	o.output = output
	fmt.Println("Write temp:", output)

	out, err := os.Create(output)
	if err != nil {
		return err
	}
	defer out.Close()

	matched := false
	scanner := bufio.NewScanner(in)
	for scanner.Scan() {
		line := scanner.Text()
		for _, set := range o.rgs {
			if m := set.rg.FindStringSubmatch(line); len(m) > 1 {
				line = fmt.Sprintf(set.format, o.v)
				matched = true
				break
			}
		}
		fmt.Fprintln(out, line)
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	// A silent no-op here would let the mirrors drift out of sync — the whole
	// point of the tool — so treat a missing version line as an error.
	if !matched {
		return fmt.Errorf("%s: no version line matched", o.input)
	}
	return nil
}
